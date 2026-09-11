package sevendtd

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
	"github.com/mastermind/agent/internal/games/7dtd/configmerge"
)

const gameSlug = "7dtd"

// Adapter implements agent.GameAdapter for 7 Days to Die (telnet admin + process control).
type Adapter struct {
	// Runner is used for Start/Stop/Restart when no custom commands are set.
	Runner *runnerShim
}

// runnerShim allows the adapter to run start/stop commands (could be replaced by agent runner).
type runnerShim struct {
	timeout time.Duration
}

func (r *runnerShim) run(ctx context.Context, dir, name string, args ...string) error {
	if r != nil && r.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, r.timeout)
		defer cancel()
	}
	if name == "/usr/bin/sudo" && (len(args) == 0 || args[0] != "-n") {
		args = append([]string{"-n"}, args...)
	}
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	return cmd.Run()
}

// NewAdapter returns a 7DTD game adapter.
func NewAdapter() *Adapter {
	return &Adapter{
		Runner: &runnerShim{timeout: 5 * time.Minute},
	}
}

func (a *Adapter) Name() string { return gameSlug }

func (a *Adapter) Capabilities() []string {
	return append([]string(nil), agent.AllCapabilities...)
}

// Execute dispatches job types to the appropriate capability (e.g. SERVER_START -> Start).
func (a *Adapter) Execute(ctx context.Context, job agent.Job) (agent.JobResult, error) {
	cfg := jobPayloadToConfig(job.Payload)
	switch strings.ToUpper(job.Type) {
	case "SERVER_START":
		return resultOrErr(a.Start(ctx, cfg))
	case "SERVER_STOP":
		return resultOrErr(a.Stop(ctx, cfg))
	case "SERVER_KILL":
		return resultOrErr(a.Kill(ctx))
	case "SERVER_RESTART":
		return resultOrErr(a.Restart(ctx, cfg))
	case "SERVER_SAFE_RESTART":
		return a.SafeRestart(ctx, cfg, job.Payload)
	case "SERVER_SAVEWORLD":
		return a.SaveWorld(ctx, cfg)
	case "SERVER_SAVE_STOP":
		return a.SaveStop(ctx, cfg, job.Payload)
	case "SERVER_MAINTENANCE":
		return a.SetMaintenance(ctx, cfg, job.Payload)
	case "SERVER_UPDATE":
		return a.Update(ctx, cfg)
	case "SERVER_WIPE_SAVE":
		if !getBool(job.Payload, "confirmed") {
			return agent.JobResult{Status: "failed", Error: "save wipe requires explicit confirmation"}, nil
		}
		path, err := a.WipeSave(ctx, cfg, getString(job.Payload, "server_config_path", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"deletedSave": path, "restarted": true}}, nil
	case "RCON", "SEND_COMMAND":
		cmd := strings.TrimSpace(getString(job.Payload, "command", ""))
		if cmd == "" {
			return agent.JobResult{Status: "failed", Error: "console command is required"}, nil
		}
		if len(cmd) > 512 || strings.ContainsAny(cmd, "\r\n") {
			return agent.JobResult{Status: "failed", Error: "console command must be one line and at most 512 characters"}, nil
		}
		out, err := a.SendCommand(ctx, cfg, cmd)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		if strings.EqualFold(getString(job.Payload, "purpose", ""), "inventory_snapshot") {
			if detailed, ok := latestPlayerLogInventory(cfg.InstallPath, cmd); ok {
				out = detailed
			}
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "PLAYER_LIST_SYNC":
		out, err := a.SendCommand(ctx, cfg, "lp")
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "PLAYER_ADMIN_LIST":
		admins, err := listServerAdmins(job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"admins": admins}}, nil
	case "PLAYER_ADMIN_PROMOTE", "PLAYER_ADMIN_DEMOTE":
		identifier := sanitizeRCONArg(getString(job.Payload, "identifier", ""))
		platform := getString(job.Payload, "platform", "")
		if !strings.EqualFold(platform, "Steam") && !strings.EqualFold(platform, "EOS") {
			return agent.JobResult{Status: "failed", Error: "player platform must be Steam or EOS"}, nil
		}
		if identifier == "" {
			return agent.JobResult{Status: "failed", Error: "player Steam/EOS ID required"}, nil
		}
		platformPrefix := "Steam"
		if strings.EqualFold(platform, "EOS") {
			platformPrefix = "EOS"
		}
		platformID := fmt.Sprintf("%s_%s", platformPrefix, identifier)
		command := fmt.Sprintf("admin add %s 0", platformID)
		if strings.EqualFold(job.Type, "PLAYER_ADMIN_DEMOTE") {
			command = fmt.Sprintf("admin remove %s", platformID)
		}
		out, err := a.SendCommand(ctx, cfg, command)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		if strings.Contains(strings.ToLower(out), " is not a valid ") || strings.Contains(strings.ToLower(out), "error executing command") {
			return agent.JobResult{Status: "failed", Error: "7DTD rejected administrator command", Output: out}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "REGION_HEALER_START":
		return resultOrErr(a.Runner.run(ctx, "", "/usr/bin/sudo", "/usr/bin/systemctl", "start", "regionhealer.service"))
	case "REGION_HEALER_STOP":
		return resultOrErr(a.Runner.run(ctx, "", "/usr/bin/sudo", "/usr/bin/systemctl", "stop", "regionhealer.service"))
	case "REGION_HEALER_STATUS":
		settings, err := regionHealerSettings(ctx)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: settings}, nil
	case "REGION_HEALER_CONFIGURE":
		backupTime := strings.TrimSpace(getString(job.Payload, "backup_time", ""))
		if !regexp.MustCompile(`^(?:[01]\d|2[0-3]):[0-5]\d$`).MatchString(backupTime) {
			return agent.JobResult{Status: "failed", Error: "backup time must use 24-hour HH:MM format"}, nil
		}
		settings, err := configureRegionHealer(ctx, backupTime)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: settings}, nil
	case "SAVE_LIST":
		saves, err := a.ListSaves(cfg, getString(job.Payload, "server_config_path", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"saves": saves}}, nil
	case "SAVE_BACKUP":
		save, err := a.BackupSave(ctx, cfg, getString(job.Payload, "server_config_path", ""), getInt(job.Payload, "retention_count", 10))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"save": save}}, nil
	case "SAVE_RESTORE":
		if !getBool(job.Payload, "confirmed") {
			return agent.JobResult{Status: "failed", Error: "save restore requires explicit confirmation"}, nil
		}
		save, err := a.RestoreSave(ctx, cfg, getString(job.Payload, "server_config_path", ""), getString(job.Payload, "save_id", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"save": save, "serverStopped": true}}, nil
	case "SAVE_DELETE":
		if !getBool(job.Payload, "confirmed") {
			return agent.JobResult{Status: "failed", Error: "save deletion requires explicit confirmation"}, nil
		}
		if err := a.DeleteSaveBackup(ctx, getString(job.Payload, "save_id", "")); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"deleted": getString(job.Payload, "save_id", "")}}, nil
	case "SAVE_RETENTION":
		retention := getInt(job.Payload, "retention_count", 10)
		if retention < 1 || retention > 100 {
			return agent.JobResult{Status: "failed", Error: "retention count must be between 1 and 100"}, nil
		}
		if err := pruneFullSaveBackups(retention); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"retentionCount": retention}}, nil
	case "PLAYER_KICK":
		identifier := playerCommandIdentifier(job.Payload)
		reason := sanitizeRCONArg(getString(job.Payload, "reason", "Removed by administrator"))
		if identifier == "" {
			return agent.JobResult{Status: "failed", Error: "player identifier required"}, nil
		}
		out, err := a.SendCommand(ctx, cfg, fmt.Sprintf("kick %s %q", identifier, reason))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		if consoleRejected(out) {
			return agent.JobResult{Status: "failed", Error: "7DTD rejected kick command", Output: out}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "PLAYER_KICK_ALL":
		reason := sanitizeRCONArg(getString(job.Payload, "reason", "Removed by administrator"))
		if strings.TrimSpace(reason) == "" {
			reason = "Removed by administrator"
		}
		out, err := a.SendCommand(ctx, cfg, fmt.Sprintf("kickall %q", reason))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		if consoleRejected(out) {
			return agent.JobResult{Status: "failed", Error: "7DTD rejected kickall command", Output: out}, nil
		}
		select {
		case <-ctx.Done():
			return agent.JobResult{Status: "failed", Error: ctx.Err().Error()}, nil
		case <-time.After(2 * time.Second):
		}
		verification, err := a.SendCommand(ctx, cfg, "lp")
		if err != nil {
			return agent.JobResult{Status: "failed", Error: fmt.Sprintf("kickall sent but verification failed: %v", err), Output: out}, nil
		}
		remaining, err := playerCountFromList(verification)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: fmt.Sprintf("kickall sent but verification failed: %v", err), Output: out + "\n" + verification}, nil
		}
		if remaining != 0 {
			return agent.JobResult{Status: "failed", Error: fmt.Sprintf("kickall verification found %d player(s) still online", remaining), Output: out + "\n" + verification}, nil
		}
		return agent.JobResult{Status: "success", Output: out + "\nVerification: 0 players online", Result: map[string]interface{}{"playersRemaining": 0}}, nil
	case "PLAYER_BAN":
		identifier := playerCommandIdentifier(job.Payload)
		reason := sanitizeRCONArg(getString(job.Payload, "reason", "Banned by administrator"))
		duration := sanitizeRCONArg(getString(job.Payload, "duration", "1 days"))
		if identifier == "" {
			return agent.JobResult{Status: "failed", Error: "player identifier required"}, nil
		}
		out, err := a.SendCommand(ctx, cfg, fmt.Sprintf("ban add %s %s %q", identifier, duration, reason))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		if consoleRejected(out) {
			return agent.JobResult{Status: "failed", Error: "7DTD rejected ban command", Output: out}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "PLAYER_SET_DEATHS":
		deaths := getInt(job.Payload, "deaths", -1)
		out, command, err := a.setPlayerDeaths(ctx, cfg, job.Payload, deaths)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error(), Output: out}, nil
		}
		return agent.JobResult{Status: "success", Output: out, Result: map[string]interface{}{"command": command, "deaths": deaths}}, nil
	case "MOD_LIST":
		mods, err := listMods(cfg, getString(job.Payload, "mods_path", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"mods": mods}}, nil
	case "MOD_UPLOAD_QUARANTINE":
		folders, err := installUploadedModsToQuarantine(
			cfg,
			getString(job.Payload, "mods_path", ""),
			getString(job.Payload, "archive_path", ""),
			getString(job.Payload, "originalName", "uploaded-mod.zip"),
			getBool(job.Payload, "overrideActive"),
			getBool(job.Payload, "transferConfig"),
		)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"folders": folders, "count": len(folders), "quarantined": true}}, nil
	case "MOD_UPLOAD_PENDING":
		folders, err := installUploadedModsToPending(
			cfg,
			getString(job.Payload, "mods_path", ""),
			getString(job.Payload, "archive_path", ""),
			getString(job.Payload, "originalName", "uploaded-mod.zip"),
			getString(job.Payload, "recommendedBy", ""),
			getString(job.Payload, "recommendedById", ""),
			getString(job.Payload, "description", ""),
		)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"folders": folders, "count": len(folders), "pending": true}}, nil
	case "MOD_PENDING_LIST":
		root, err := pendingPath(cfg, getString(job.Payload, "mods_path", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		mods, err := listPendingMods(root)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"mods": mods}}, nil
	case "MOD_PENDING_APPROVE":
		folder := getString(job.Payload, "folder", "")
		if err := approvePendingMod(cfg, getString(job.Payload, "mods_path", ""), folder); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"approved": folder}}, nil
	case "MOD_PENDING_REJECT":
		folder := getString(job.Payload, "folder", "")
		if err := rejectPendingMod(cfg, getString(job.Payload, "mods_path", ""), folder); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"rejected": folder}}, nil
	case "MOD_QUARANTINE":
		folder := getString(job.Payload, "folder", "")
		if err := quarantineMod(cfg, getString(job.Payload, "mods_path", ""), folder); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"quarantined": folder}}, nil
	case "MOD_QUARANTINE_LIST":
		mods, err := listQuarantinedMods(cfg, getString(job.Payload, "mods_path", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"mods": mods}}, nil
	case "MOD_RESTORE":
		folder := getString(job.Payload, "folder", "")
		var transferOverride *bool
		if _, ok := job.Payload["transferConfig"]; ok {
			value := getBool(job.Payload, "transferConfig")
			transferOverride = &value
		}
		result, err := restoreMod(cfg, getString(job.Payload, "mods_path", ""), folder, getBool(job.Payload, "forceOverride"), transferOverride)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{
			"restored":       folder,
			"restoredAs":     result.RestoredAs,
			"transferConfig": result.TransferConfig,
			"sourceFolder":   result.SourceFolder,
		}}, nil
	case "MOD_DELETE":
		folder := getString(job.Payload, "folder", "")
		source := strings.ToLower(strings.TrimSpace(getString(job.Payload, "source", "active")))
		var err error
		switch source {
		case "quarantine", "quarantined":
			err = deleteQuarantinedMod(cfg, getString(job.Payload, "mods_path", ""), folder)
		default:
			err = deleteModWithPipe(ctx, cfg, getString(job.Payload, "mods_path", ""), folder)
		}
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"deleted": folder, "source": source}}, nil
	case "MOD_CONFIG_READ":
		folder := getString(job.Payload, "folder", "")
		path := getString(job.Payload, "path", "")
		content, err := readModConfig(cfg, getString(job.Payload, "mods_path", ""), folder, path)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"folder": folder, "path": path, "content": content}}, nil
	case "MOD_CONFIG_WRITE":
		folder := getString(job.Payload, "folder", "")
		path := getString(job.Payload, "path", "")
		content := getString(job.Payload, "content", "")
		if err := writeModConfig(cfg, getString(job.Payload, "mods_path", ""), folder, path, content); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"folder": folder, "path": path, "saved": true}}, nil
	case "MOD_CONFIG_MERGE_PREVIEW":
		result, err := previewConfigMerge(cfg, getString(job.Payload, "mods_path", ""), getString(job.Payload, "sourceFolder", ""), getString(job.Payload, "targetFolder", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"files": result}}, nil
	case "MOD_CONFIG_MERGE_APPLY":
		files, _ := job.Payload["files"].([]interface{})
		if len(files) == 0 {
			return agent.JobResult{Status: "failed", Error: "no files to apply"}, nil
		}
		applied := 0
		targetFolder := getString(job.Payload, "folder", "")
		for _, f := range files {
			entry, ok := f.(map[string]interface{})
			if !ok {
				continue
			}
			path := getString(entry, "path", "")
			content := getString(entry, "content", "")
			if path == "" || content == "" {
				continue
			}
			if err := writeModConfig(cfg, getString(job.Payload, "mods_path", ""), targetFolder, path, content); err != nil {
				return agent.JobResult{Status: "failed", Error: fmt.Sprintf("write %s: %s", path, err.Error())}, nil
			}
			applied++
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"applied": applied, "folder": targetFolder}}, nil
	case "SERVER_CONFIG_READ":
		content, path, err := readConfiguredServerConfig(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"path": path, "content": content}}, nil
	case "SERVER_CONFIG_WRITE":
		content := getString(job.Payload, "content", "")
		path, err := writeConfiguredServerConfig(cfg, job.Payload, content)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"path": path, "saved": true}}, nil
	case "TRIGGER_LAND_CLAIM":
		result, err := applyLandClaimReward(ctx, a, cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	case "TRIGGER_GRANT_ITEMS":
		result, err := applyGrantItemsReward(ctx, a, cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	case "ITEM_CATALOG":
		catalog, err := listItemCatalog(cfg)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: catalog}, nil
	case "POI_CATALOG":
		catalog, err := listPOICatalog(cfg)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: catalog}, nil
	case "POI_PREVIEW":
		preview, err := readPOIPreview(cfg, getString(job.Payload, "name", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: preview}, nil
	case "PROFILE_LIST":
		profiles, err := listPlayerProfiles(job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"profiles": profiles}}, nil
	case "PROFILE_READ":
		profile, content, err := readPlayerProfile(job.Payload, getString(job.Payload, "path", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"profile": profile, "contentBase64": base64.StdEncoding.EncodeToString(content)}}, nil
	case "PROFILE_STAGE":
		profile, err := stagePlayerProfile(job.Payload, getString(job.Payload, "path", ""), getString(job.Payload, "contentBase64", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"profile": profile, "staged": true, "appliesOnNextStart": true}}, nil
	case "PROFILE_DELETE_STAGE":
		profiles, err := stagePlayerProfileDelete(cfg, job.Payload, getString(job.Payload, "steamId", ""), getString(job.Payload, "eosId", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"profiles": profiles, "staged": true, "permanent": true, "appliesOnNextStart": true}}, nil
	default:
		return agent.JobResult{Status: "failed", Error: "unsupported job type: " + job.Type}, nil
	}
}

// Keep the base64 job result below Nest's default JSON request limit.
// Normal 7DTD profiles are only tens of KiB.
const maxProfileEditorBytes = 64 * 1024

var profileStagingRoot = "/var/lib/mastermind-agent/profile-staging"
var profileBackupRoot = "/var/lib/mastermind-agent/profile-backups"
var sevenDaysRunning = func() bool {
	return exec.Command("/usr/bin/systemctl", "is-active", "--quiet", "7dtd.service").Run() == nil
}

type playerProfile struct {
	Path               string    `json:"path"`
	Name               string    `json:"name"`
	PlayerName         string    `json:"playerName,omitempty"`
	World              string    `json:"world"`
	Save               string    `json:"save"`
	SizeBytes          int64     `json:"sizeBytes"`
	ModifiedAt         time.Time `json:"modifiedAt"`
	InjectionStatus    string    `json:"injectionStatus,omitempty"`
	InjectionStagedAt  time.Time `json:"injectionStagedAt,omitempty"`
	InjectionAppliedAt time.Time `json:"injectionAppliedAt,omitempty"`
}

type profileInjectionState struct {
	Status    string
	StagedAt  time.Time
	AppliedAt time.Time
}

type persistentPlayerData struct {
	Players []struct {
		UserID       string `xml:"userid,attr"`
		NativeUserID string `xml:"nativeuserid,attr"`
		PlayerName   string `xml:"playername,attr"`
	} `xml:"player"`
}

func profilePlayerNames(saveDir string) map[string]string {
	names := map[string]string{}
	content, err := os.ReadFile(filepath.Join(saveDir, "players.xml"))
	if err != nil {
		return names
	}
	var data persistentPlayerData
	if xml.Unmarshal(content, &data) != nil {
		return names
	}
	for _, player := range data.Players {
		for _, id := range []string{player.UserID, player.NativeUserID} {
			id = strings.TrimSpace(id)
			if id != "" && player.PlayerName != "" {
				names[strings.ToLower(id)] = player.PlayerName
			}
		}
	}
	return names
}

func profileOwner(path string, cache map[string]map[string]string) string {
	saveDir := filepath.Dir(filepath.Dir(path))
	names, ok := cache[saveDir]
	if !ok {
		names = profilePlayerNames(saveDir)
		cache[saveDir] = names
	}
	id := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	id = strings.TrimPrefix(strings.TrimPrefix(id, "EOS_"), "Steam_")
	return names[strings.ToLower(id)]
}

func configuredSavesPath(payload map[string]interface{}) (string, error) {
	config, _ := payload["config"].(map[string]interface{})
	discovery, _ := config["discovery"].(map[string]interface{})
	root, _ := discovery["savesPath"].(string)
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "." || !filepath.IsAbs(root) {
		return "", fmt.Errorf("configured absolute saves path required")
	}
	info, err := os.Lstat(root)
	if err != nil {
		return "", fmt.Errorf("read saves directory: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("saves path must be a real directory")
	}
	return root, nil
}

func listPlayerProfiles(payload map[string]interface{}) ([]playerProfile, error) {
	root, err := configuredSavesPath(payload)
	if err != nil {
		return nil, err
	}
	profiles := []playerProfile{}
	ownerCache := map[string]map[string]string{}
	err = filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if info.IsDir() || !strings.EqualFold(filepath.Ext(info.Name()), ".ttp") || !strings.EqualFold(filepath.Base(filepath.Dir(path)), "Player") {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		parts := strings.Split(filepath.ToSlash(rel), "/")
		if len(parts) < 4 {
			return nil
		}
		profiles = append(profiles, playerProfile{Path: filepath.ToSlash(rel), Name: info.Name(), PlayerName: profileOwner(path, ownerCache), World: parts[len(parts)-4], Save: parts[len(parts)-3], SizeBytes: info.Size(), ModifiedAt: info.ModTime().UTC()})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("scan player profiles: %w", err)
	}
	states := playerProfileInjectionStates(getString(payload, "server_instance_id", ""))
	for index := range profiles {
		if state, ok := states[profiles[index].Path]; ok {
			profiles[index].InjectionStatus = state.Status
			profiles[index].InjectionStagedAt = state.StagedAt
			profiles[index].InjectionAppliedAt = state.AppliedAt
		}
	}
	sort.Slice(profiles, func(i, j int) bool { return profiles[i].ModifiedAt.After(profiles[j].ModifiedAt) })
	return profiles, nil
}

func playerProfileInjectionStates(serverID string) map[string]profileInjectionState {
	states := map[string]profileInjectionState{}
	if serverID == "" {
		return states
	}
	backupDir := filepath.Join(profileBackupRoot, serverID)
	if entries, err := os.ReadDir(backupDir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
				continue
			}
			content, readErr := os.ReadFile(filepath.Join(backupDir, entry.Name()))
			if readErr != nil {
				continue
			}
			var metadata profileBackupMetadata
			if json.Unmarshal(content, &metadata) != nil || metadata.OriginalPath == "" || metadata.AppliedAt.IsZero() {
				continue
			}
			path := filepath.ToSlash(metadata.OriginalPath)
			current, exists := states[path]
			if !exists || metadata.AppliedAt.After(current.AppliedAt) {
				states[path] = profileInjectionState{Status: "applied", StagedAt: metadata.StagedAt, AppliedAt: metadata.AppliedAt}
			}
		}
	}
	stagingDir := filepath.Join(profileStagingRoot, serverID)
	if entries, err := os.ReadDir(stagingDir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
				continue
			}
			content, readErr := os.ReadFile(filepath.Join(stagingDir, entry.Name()))
			if readErr != nil {
				continue
			}
			var metadata stagedProfileMetadata
			if json.Unmarshal(content, &metadata) != nil || metadata.Relative == "" {
				continue
			}
			path := filepath.ToSlash(metadata.Relative)
			status := "queued"
			if metadata.Action == "delete" {
				status = "reset_queued"
			}
			states[path] = profileInjectionState{Status: status, StagedAt: metadata.StagedAt}
		}
	}
	return states
}

func readPlayerProfile(payload map[string]interface{}, relative string) (playerProfile, []byte, error) {
	root, err := configuredSavesPath(payload)
	if err != nil {
		return playerProfile{}, nil, err
	}
	relative = filepath.Clean(filepath.FromSlash(strings.TrimSpace(relative)))
	if relative == "." || filepath.IsAbs(relative) || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || !strings.EqualFold(filepath.Ext(relative), ".ttp") {
		return playerProfile{}, nil, fmt.Errorf("invalid profile path")
	}
	target := filepath.Join(root, relative)
	info, err := os.Lstat(target)
	if err != nil {
		return playerProfile{}, nil, fmt.Errorf("read player profile: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || !strings.EqualFold(filepath.Base(filepath.Dir(target)), "Player") {
		return playerProfile{}, nil, fmt.Errorf("profile must be a regular .ttp file in a Player directory")
	}
	if info.Size() > maxProfileEditorBytes {
		return playerProfile{}, nil, fmt.Errorf("profile exceeds 2 MiB editor transfer limit")
	}
	content, err := os.ReadFile(target)
	if err != nil {
		return playerProfile{}, nil, fmt.Errorf("copy player profile: %w", err)
	}
	parts := strings.Split(filepath.ToSlash(relative), "/")
	profile := playerProfile{Path: filepath.ToSlash(relative), Name: info.Name(), PlayerName: profileOwner(target, map[string]map[string]string{}), SizeBytes: info.Size(), ModifiedAt: info.ModTime().UTC()}
	if len(parts) >= 4 {
		profile.World, profile.Save = parts[len(parts)-4], parts[len(parts)-3]
	}
	return profile, content, nil
}

type stagedProfileMetadata struct {
	Target   string    `json:"target"`
	Relative string    `json:"relative"`
	StagedAt time.Time `json:"stagedAt"`
	Action   string    `json:"action,omitempty"`
}

type profileBackupMetadata struct {
	OriginalPath string    `json:"originalPath"`
	StagedAt     time.Time `json:"stagedAt"`
	AppliedAt    time.Time `json:"appliedAt"`
	OriginalFile string    `json:"originalFile"`
	BackupFile   string    `json:"backupFile,omitempty"`
}

func stagePlayerProfile(payload map[string]interface{}, relative, encoded string) (playerProfile, error) {
	profile, _, err := readPlayerProfile(payload, relative)
	if err != nil {
		return playerProfile{}, err
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(content) == 0 || len(content) > maxProfileEditorBytes {
		return playerProfile{}, fmt.Errorf("invalid staged profile data")
	}
	if len(content) < 4 || string(content[:4]) != "ttp\x00" {
		return playerProfile{}, fmt.Errorf("staged data does not have a valid TTP header")
	}
	root, err := configuredSavesPath(payload)
	if err != nil {
		return playerProfile{}, err
	}
	target := filepath.Join(root, filepath.FromSlash(profile.Path))
	serverID := getString(payload, "server_instance_id", "")
	if serverID == "" {
		return playerProfile{}, fmt.Errorf("server instance ID required")
	}
	dir := filepath.Join(profileStagingRoot, serverID)
	if err := os.MkdirAll(dir, 0750); err != nil {
		return playerProfile{}, fmt.Errorf("create profile staging directory: %w", err)
	}
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(profile.Path)))
	dataPath, metadataPath := filepath.Join(dir, key+".ttp"), filepath.Join(dir, key+".json")
	temporary := dataPath + ".tmp"
	if err := os.WriteFile(temporary, content, 0640); err != nil {
		return playerProfile{}, fmt.Errorf("write staged profile: %w", err)
	}
	if err := os.Rename(temporary, dataPath); err != nil {
		return playerProfile{}, fmt.Errorf("commit staged profile: %w", err)
	}
	metadata, _ := json.Marshal(stagedProfileMetadata{Target: target, Relative: profile.Path, StagedAt: time.Now().UTC()})
	if err := os.WriteFile(metadataPath, metadata, 0640); err != nil {
		_ = os.Remove(dataPath)
		return playerProfile{}, fmt.Errorf("write staged profile metadata: %w", err)
	}
	return profile, nil
}

func validProfileIdentifier(value string) bool {
	if len(value) == 0 || len(value) > 128 {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z') && !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && r != '_' && r != '-' {
			return false
		}
	}
	return true
}

// activePlayerProfiles resolves only the configured active world/save. Player
// reset must never reach historical worlds merely because they share an ID.
func activePlayerProfiles(cfg *agent.InstanceConfig, payload map[string]interface{}, steamID, eosID string) ([]playerProfile, error) {
	steamID = strings.TrimSpace(steamID)
	eosID = strings.TrimSpace(eosID)
	if len(steamID) >= len("Steam_") && strings.EqualFold(steamID[:len("Steam_")], "Steam_") {
		steamID = steamID[len("Steam_"):]
	}
	if len(eosID) >= len("EOS_") && strings.EqualFold(eosID[:len("EOS_")], "EOS_") {
		eosID = eosID[len("EOS_"):]
	}
	if (steamID != "" && !validProfileIdentifier(steamID)) || (eosID != "" && !validProfileIdentifier(eosID)) {
		return nil, fmt.Errorf("invalid player profile identifier")
	}
	if steamID == "" && eosID == "" {
		return nil, fmt.Errorf("Steam or EOS ID is required")
	}
	root, err := configuredSavesPath(payload)
	if err != nil {
		return nil, err
	}
	configPath, err := configuredServerConfigPath(cfg, payload)
	if err != nil {
		return nil, err
	}
	liveSave, err := resolveLiveSave(cfg, configPath)
	if err != nil {
		return nil, err
	}
	if !pathInside(root, liveSave) {
		return nil, fmt.Errorf("configured active save is outside the configured saves directory")
	}
	liveInfo, err := os.Lstat(liveSave)
	if err != nil {
		return nil, fmt.Errorf("read configured active save: %w", err)
	}
	if !liveInfo.IsDir() || liveInfo.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("configured active save must be a real directory")
	}
	playerDir := filepath.Join(liveSave, "Player")
	dirInfo, err := os.Lstat(playerDir)
	if err != nil {
		return nil, fmt.Errorf("read active player profiles: %w", err)
	}
	if !dirInfo.IsDir() || dirInfo.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("active Player directory must be a real directory")
	}

	candidates := make([]string, 0, 2)
	if steamID != "" {
		candidates = append(candidates, "Steam_"+steamID+".ttp")
	}
	if eosID != "" {
		candidates = append(candidates, "EOS_"+eosID+".ttp")
	}
	profiles := make([]playerProfile, 0, len(candidates))
	seen := map[string]bool{}
	for _, name := range candidates {
		if seen[name] {
			continue
		}
		seen[name] = true
		target := filepath.Join(playerDir, name)
		info, statErr := os.Lstat(target)
		if os.IsNotExist(statErr) {
			continue
		}
		if statErr != nil {
			return nil, fmt.Errorf("read active player profile: %w", statErr)
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("active player profile must be a regular file: %s", name)
		}
		relative, relErr := filepath.Rel(root, target)
		if relErr != nil || relative == "." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
			return nil, fmt.Errorf("active player profile is outside the configured saves directory")
		}
		parts := strings.Split(filepath.ToSlash(relative), "/")
		profile := playerProfile{Path: filepath.ToSlash(relative), Name: name, PlayerName: profileOwner(target, map[string]map[string]string{}), SizeBytes: info.Size(), ModifiedAt: info.ModTime().UTC()}
		if len(parts) >= 4 {
			profile.World, profile.Save = parts[len(parts)-4], parts[len(parts)-3]
		}
		profiles = append(profiles, profile)
	}
	if len(profiles) == 0 {
		return nil, fmt.Errorf("no active player profile matched the supplied Steam or EOS ID")
	}
	return profiles, nil
}

func stagePlayerProfileDelete(cfg *agent.InstanceConfig, payload map[string]interface{}, steamID, eosID string) ([]playerProfile, error) {
	profiles, err := activePlayerProfiles(cfg, payload, steamID, eosID)
	if err != nil {
		return nil, err
	}
	serverID := getString(payload, "server_instance_id", "")
	if serverID == "" {
		return nil, fmt.Errorf("server instance ID required")
	}
	root, err := configuredSavesPath(payload)
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(profileStagingRoot, serverID)
	if err := os.MkdirAll(dir, 0750); err != nil {
		return nil, fmt.Errorf("create profile staging directory: %w", err)
	}
	for _, profile := range profiles {
		key := fmt.Sprintf("%x", sha256.Sum256([]byte(profile.Path)))
		metadataPath := filepath.Join(dir, key+".json")
		metadata, _ := json.Marshal(stagedProfileMetadata{Target: filepath.Join(root, filepath.FromSlash(profile.Path)), Relative: profile.Path, StagedAt: time.Now().UTC(), Action: "delete"})
		if err := os.WriteFile(metadataPath, metadata, 0640); err != nil {
			return nil, fmt.Errorf("write profile reset metadata: %w", err)
		}
		// A delete marker overrides an existing staged replacement. Its leftover
		// data is ignored and removed together with the marker at the next start.
	}
	return profiles, nil
}

func deletePlayerProfileFiles(target string) error {
	paths := []string{target, target + ".bak"}
	for _, path := range paths {
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return fmt.Errorf("read player profile for reset: %w", err)
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("player profile reset target must be a regular file: %s", filepath.Base(path))
		}
	}
	for _, path := range paths {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("permanently delete player profile: %w", err)
		}
	}
	return nil
}

func applyStagedPlayerProfiles(serverID string) error {
	if serverID == "" {
		return nil
	}
	dir := filepath.Join(profileStagingRoot, serverID)
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read staged profiles: %w", err)
	}
	hasQueued := false
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".json" {
			hasQueued = true
			break
		}
	}
	if hasQueued && sevenDaysRunning() {
		return fmt.Errorf("7DTD must be fully stopped before applying staged profiles")
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		metadataPath := filepath.Join(dir, entry.Name())
		metadataBytes, err := os.ReadFile(metadataPath)
		if err != nil {
			return err
		}
		var metadata stagedProfileMetadata
		if json.Unmarshal(metadataBytes, &metadata) != nil || !filepath.IsAbs(metadata.Target) || !strings.EqualFold(filepath.Base(filepath.Dir(metadata.Target)), "Player") || !strings.EqualFold(filepath.Ext(metadata.Target), ".ttp") {
			return fmt.Errorf("invalid staged profile metadata")
		}
		dataPath := strings.TrimSuffix(metadataPath, ".json") + ".ttp"
		if metadata.Action == "delete" {
			if err := deletePlayerProfileFiles(metadata.Target); err != nil {
				return err
			}
			if err := os.Remove(dataPath); err != nil && !os.IsNotExist(err) {
				return err
			}
			if err := os.Remove(metadataPath); err != nil {
				return err
			}
			continue
		}
		if metadata.Action != "" {
			return fmt.Errorf("invalid staged profile action")
		}
		info, err := os.Lstat(metadata.Target)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("live profile is no longer a regular file: %s", metadata.Relative)
		}
		content, err := os.ReadFile(dataPath)
		if err != nil || len(content) < 4 || string(content[:4]) != "ttp\x00" {
			return fmt.Errorf("invalid queued profile: %s", metadata.Relative)
		}
		appliedAt := time.Now().UTC()
		timestamp := appliedAt.Format("20060102T150405.000000000Z")
		backupDir := filepath.Join(profileBackupRoot, serverID)
		if err := os.MkdirAll(backupDir, 0750); err != nil {
			return err
		}
		baseName := strings.TrimSuffix(filepath.Base(metadata.Target), filepath.Ext(metadata.Target))
		originalName := baseName + ".original-" + timestamp + ".ttp"
		if err := copySaveFile(metadata.Target, filepath.Join(backupDir, originalName), info.Mode().Perm()); err != nil {
			return fmt.Errorf("back up live profile: %w", err)
		}
		backupName := ""
		if bakInfo, bakErr := os.Lstat(metadata.Target + ".bak"); bakErr == nil && bakInfo.Mode().IsRegular() {
			backupName = baseName + ".original-" + timestamp + ".ttp.bak"
			if err := copySaveFile(metadata.Target+".bak", filepath.Join(backupDir, backupName), bakInfo.Mode().Perm()); err != nil {
				return fmt.Errorf("back up live profile companion: %w", err)
			}
		}
		archiveMetadata, _ := json.MarshalIndent(profileBackupMetadata{OriginalPath: metadata.Relative, StagedAt: metadata.StagedAt, AppliedAt: appliedAt, OriginalFile: originalName, BackupFile: backupName}, "", "  ")
		if err := os.WriteFile(filepath.Join(backupDir, baseName+".original-"+timestamp+".json"), archiveMetadata, 0640); err != nil {
			return fmt.Errorf("write profile backup metadata: %w", err)
		}
		temporary, err := os.CreateTemp(filepath.Dir(metadata.Target), ".mastermind-profile-*")
		if err != nil {
			return fmt.Errorf("create replacement profile: %w", err)
		}
		temporaryPath := temporary.Name()
		if chmodErr := temporary.Chmod(info.Mode().Perm()); chmodErr != nil {
			_ = temporary.Close()
			_ = os.Remove(temporaryPath)
			return chmodErr
		}
		if _, writeErr := temporary.Write(content); writeErr != nil {
			_ = temporary.Close()
			_ = os.Remove(temporaryPath)
			return fmt.Errorf("write replacement profile: %w", writeErr)
		}
		if syncErr := temporary.Sync(); syncErr != nil {
			_ = temporary.Close()
			_ = os.Remove(temporaryPath)
			return syncErr
		}
		if closeErr := temporary.Close(); closeErr != nil {
			_ = os.Remove(temporaryPath)
			return closeErr
		}
		if err := os.Rename(temporaryPath, metadata.Target); err != nil {
			_ = os.Remove(temporaryPath)
			return fmt.Errorf("install replacement profile: %w", err)
		}
		if err := copySaveFile(metadata.Target, metadata.Target+".bak", info.Mode().Perm()); err != nil {
			return fmt.Errorf("write injected profile companion: %w", err)
		}
		if err := os.Remove(dataPath); err != nil {
			return err
		}
		if err := os.Remove(metadataPath); err != nil {
			return err
		}
	}
	return nil
}

func validateModFolder(folder string) error {
	if folder == "" || folder == "." || folder == ".." || filepath.Base(folder) != folder || strings.ContainsAny(folder, `/\\`) {
		return fmt.Errorf("invalid mod folder")
	}
	return nil
}

func realModDirectory(root, folder string) (string, error) {
	if err := validateModFolder(folder); err != nil {
		return "", err
	}
	target := filepath.Join(root, folder)
	info, err := os.Lstat(target)
	if err != nil {
		return "", fmt.Errorf("mod folder not found: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("mod target must be a real directory")
	}
	return target, nil
}

func quarantineMod(cfg *agent.InstanceConfig, override, folder string) error {
	root, err := modsPath(cfg, override)
	if err != nil {
		return err
	}
	target, err := realModDirectory(root, folder)
	if err != nil {
		return err
	}
	quarantineRoot, err := quarantinePath(cfg, override)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(quarantineRoot, 0750); err != nil {
		return fmt.Errorf("create quarantine directory: %w", err)
	}
	destination := filepath.Join(quarantineRoot, folder)
	if _, err := os.Lstat(destination); !os.IsNotExist(err) {
		return fmt.Errorf("quarantined mod already exists: %s", folder)
	}
	if output, err := exec.Command("/usr/bin/mv", "--", target, destination).CombinedOutput(); err != nil {
		return fmt.Errorf("quarantine mod: %w: %s", err, strings.TrimSpace(string(output)))
	}
	_ = os.Remove(activationMarkerPath(cfg, override, folder))
	return nil
}

const maxModArchiveFiles = 10000
const maxModArchiveExpandedBytes int64 = 2 * 1024 * 1024 * 1024

func installUploadedModsToQuarantine(cfg *agent.InstanceConfig, override, archivePath, originalName string, overrideActive, transferConfig bool) ([]string, error) {
	dest, err := quarantinePath(cfg, override)
	if err != nil {
		return nil, err
	}
	folders, err := installUploadedMods(dest, archivePath, originalName)
	if err != nil {
		return nil, err
	}
	activeRoot, err := modsPath(cfg, override)
	if err != nil {
		return nil, err
	}
	for _, folder := range folders {
		conflicts := activeModFolderExists(activeRoot, folder)
		record := quarantineRecord{
			TargetFolder:   folder,
			OverrideActive: overrideActive && conflicts,
			TransferConfig: transferConfig && overrideActive && conflicts,
		}
		if err := writeQuarantineRecord(dest, folder, record); err != nil {
			return nil, err
		}
	}
	return folders, nil
}

func installUploadedModsToPending(cfg *agent.InstanceConfig, override, archivePath, originalName, recommendedBy, recommendedById, description string) ([]string, error) {
	dest, err := pendingPath(cfg, override)
	if err != nil {
		return nil, err
	}
	folders, err := installUploadedMods(dest, archivePath, originalName)
	if err != nil {
		return nil, err
	}
	for _, folder := range folders {
		if err := writeRecommendation(dest, folder, recommendedBy, recommendedById, originalName, description); err != nil {
			return nil, err
		}
	}
	return folders, nil
}

func installUploadedMods(destRoot, archivePath, originalName string) ([]string, error) {
	archiveInfo, err := os.Lstat(archivePath)
	if err != nil {
		return nil, fmt.Errorf("open uploaded mod archive: %w", err)
	}
	if !archiveInfo.Mode().IsRegular() || archiveInfo.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("uploaded mod archive must be a regular file")
	}
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, fmt.Errorf("read uploaded ZIP: %w", err)
	}
	defer reader.Close()
	if len(reader.File) == 0 || len(reader.File) > maxModArchiveFiles {
		return nil, fmt.Errorf("ZIP must contain between 1 and %d entries", maxModArchiveFiles)
	}

	cleanNames := make(map[*zip.File]string, len(reader.File))
	rootSet := map[string]bool{}
	var expandedBytes int64
	for _, entry := range reader.File {
		name := strings.TrimSuffix(entry.Name, "/")
		if name == "" && entry.FileInfo().IsDir() {
			continue
		}
		clean := pathpkg.Clean(name)
		if name == "" || strings.Contains(entry.Name, "\\") || pathpkg.IsAbs(name) || clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || clean != name || regexp.MustCompile(`^[A-Za-z]:`).MatchString(clean) {
			return nil, fmt.Errorf("unsafe ZIP entry: %q", entry.Name)
		}
		if entry.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("ZIP symlinks are not allowed: %q", entry.Name)
		}
		if entry.UncompressedSize64 > uint64(maxModArchiveExpandedBytes) {
			return nil, fmt.Errorf("ZIP entry is too large: %q", entry.Name)
		}
		expandedBytes += int64(entry.UncompressedSize64)
		if expandedBytes > maxModArchiveExpandedBytes {
			return nil, fmt.Errorf("expanded ZIP exceeds 2 GiB limit")
		}
		cleanNames[entry] = clean
		if !entry.FileInfo().IsDir() && strings.EqualFold(pathpkg.Base(clean), "ModInfo.xml") {
			rootSet[pathpkg.Dir(clean)] = true
		}
	}
	if len(rootSet) == 0 {
		return nil, fmt.Errorf("ZIP does not contain a ModInfo.xml")
	}
	roots := make([]string, 0, len(rootSet))
	for root := range rootSet {
		roots = append(roots, root)
	}
	sort.Strings(roots)
	for i, root := range roots {
		for _, other := range roots[i+1:] {
			if root == "." || strings.HasPrefix(other, root+"/") {
				return nil, fmt.Errorf("ambiguous ZIP: nested ModInfo.xml files at %q and %q", root, other)
			}
		}
	}

	if destRoot == "" {
		return nil, fmt.Errorf("mod destination is required")
	}
	if err := os.MkdirAll(destRoot, 0750); err != nil {
		return nil, fmt.Errorf("create mod destination: %w", err)
	}
	stagingRoot, err := os.MkdirTemp(destRoot, ".upload-*")
	if err != nil {
		return nil, fmt.Errorf("create quarantine staging directory: %w", err)
	}
	defer os.RemoveAll(stagingRoot)

	archiveFolder := strings.TrimSuffix(filepath.Base(originalName), filepath.Ext(originalName))
	folderForRoot := map[string]string{}
	usedFolders := map[string]bool{}
	for _, root := range roots {
		folder := pathpkg.Base(root)
		if root == "." || strings.EqualFold(folder, "mods") {
			folder = archiveFolder
		}
		folder = regexp.MustCompile(`[^A-Za-z0-9._-]+`).ReplaceAllString(folder, "_")
		folder = strings.Trim(folder, "._-")
		if len(folder) > 100 {
			folder = folder[:100]
		}
		if err := validateModFolder(folder); err != nil || folder == "" {
			return nil, fmt.Errorf("could not derive a safe mod folder for %q", root)
		}
		if usedFolders[strings.ToLower(folder)] {
			return nil, fmt.Errorf("multiple mods resolve to the same folder: %s", folder)
		}
		usedFolders[strings.ToLower(folder)] = true
		folderForRoot[root] = folder
		if _, err := os.Lstat(filepath.Join(destRoot, folder)); !os.IsNotExist(err) {
			return nil, fmt.Errorf("mod already exists: %s", folder)
		}
		if err := os.MkdirAll(filepath.Join(stagingRoot, folder), 0750); err != nil {
			return nil, err
		}
	}

	writtenPaths := map[string]bool{}
	for entry, clean := range cleanNames {
		for _, root := range roots {
			belongs := root == "." || strings.HasPrefix(clean, root+"/") || clean == root
			if !belongs {
				continue
			}
			relative := clean
			if root != "." {
				relative = strings.TrimPrefix(strings.TrimPrefix(clean, root), "/")
			}
			if relative == "" {
				break
			}
			if strings.EqualFold(pathpkg.Base(relative), "ModInfo.xml") {
				relative = pathpkg.Join(pathpkg.Dir(relative), "ModInfo.xml")
			}
			targetRoot := filepath.Join(stagingRoot, folderForRoot[root])
			target := filepath.Join(targetRoot, filepath.FromSlash(relative))
			if target != targetRoot && !strings.HasPrefix(target, targetRoot+string(filepath.Separator)) {
				return nil, fmt.Errorf("unsafe extracted path: %q", entry.Name)
			}
			if writtenPaths[target] {
				return nil, fmt.Errorf("duplicate ZIP output path: %q", relative)
			}
			writtenPaths[target] = true
			if entry.FileInfo().IsDir() {
				if err := os.MkdirAll(target, 0750); err != nil {
					return nil, err
				}
				break
			}
			if err := os.MkdirAll(filepath.Dir(target), 0750); err != nil {
				return nil, err
			}
			source, err := entry.Open()
			if err != nil {
				return nil, fmt.Errorf("open ZIP entry %q: %w", entry.Name, err)
			}
			destination, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0640)
			if err != nil {
				_ = source.Close()
				return nil, fmt.Errorf("create extracted file %q: %w", relative, err)
			}
			copied, copyErr := io.Copy(destination, io.LimitReader(source, int64(entry.UncompressedSize64)+1))
			closeErr := destination.Close()
			sourceErr := source.Close()
			if copyErr != nil || closeErr != nil || sourceErr != nil || copied != int64(entry.UncompressedSize64) {
				return nil, fmt.Errorf("extract ZIP entry %q: archive data is incomplete or invalid", entry.Name)
			}
			break
		}
	}

	folders := make([]string, 0, len(roots))
	moved := make([]string, 0, len(roots))
	for _, root := range roots {
		folder := folderForRoot[root]
		stagedMod := filepath.Join(stagingRoot, folder)
		if _, err := os.Stat(filepath.Join(stagedMod, "ModInfo.xml")); err != nil {
			return nil, fmt.Errorf("normalized mod %s is missing ModInfo.xml", folder)
		}
		if err := normalizeModPermissions(stagedMod); err != nil {
			return nil, fmt.Errorf("normalize uploaded mod %s: %w", folder, err)
		}
		destination := filepath.Join(destRoot, folder)
		if err := os.Rename(stagedMod, destination); err != nil {
			for _, rollback := range moved {
				_ = os.RemoveAll(filepath.Join(destRoot, rollback))
			}
			return nil, fmt.Errorf("place %s: %w", folder, err)
		}
		moved = append(moved, folder)
		folders = append(folders, folder)

		// Also extract a sibling {folder}_Config tree from the ZIP when present
		// (e.g. ServerTools_Config next to ServerTools). These hold runtime XML
		// templates used by config merge / replace-with-original.
		if err := extractSiblingConfigFromZip(reader.File, cleanNames, root, folder, destRoot); err != nil {
			for _, rollback := range moved {
				_ = os.RemoveAll(filepath.Join(destRoot, rollback))
			}
			_ = os.RemoveAll(filepath.Join(destRoot, folder+"_Config"))
			return nil, err
		}
	}
	sort.Strings(folders)
	return folders, nil
}

// extractSiblingConfigFromZip copies ZIP entries under a sibling "{folder}_Config"
// directory that sits next to the mod root (same parent as ModInfo.xml's folder).
// Official ServerTools packages rarely include this; staff can add defaults for merge.
func extractSiblingConfigFromZip(files []*zip.File, cleanNames map[*zip.File]string, modRoot, folder, destRoot string) error {
	configName := folder + "_Config"
	parent := "."
	if modRoot != "." {
		parent = pathpkg.Dir(modRoot)
		if parent == "." {
			parent = ""
		}
	}
	prefix := configName + "/"
	if parent != "" {
		prefix = parent + "/" + configName + "/"
	}
	exactDir := strings.TrimSuffix(prefix, "/")
	var matched bool
	for _, entry := range files {
		clean := cleanNames[entry]
		if clean != exactDir && !strings.HasPrefix(clean, prefix) {
			continue
		}
		matched = true
		break
	}
	if !matched {
		return nil
	}
	destConfig := filepath.Join(destRoot, configName)
	if _, err := os.Lstat(destConfig); !os.IsNotExist(err) {
		return fmt.Errorf("config folder already exists: %s", configName)
	}
	if err := os.MkdirAll(destConfig, 0750); err != nil {
		return fmt.Errorf("create %s: %w", configName, err)
	}
	for entry, clean := range cleanNames {
		if clean != exactDir && !strings.HasPrefix(clean, prefix) {
			continue
		}
		relative := strings.TrimPrefix(strings.TrimPrefix(clean, exactDir), "/")
		if relative == "" {
			continue
		}
		target := filepath.Join(destConfig, filepath.FromSlash(relative))
		if target != destConfig && !strings.HasPrefix(target, destConfig+string(filepath.Separator)) {
			return fmt.Errorf("unsafe config path: %q", entry.Name)
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0750); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0750); err != nil {
			return err
		}
		source, err := entry.Open()
		if err != nil {
			return fmt.Errorf("open ZIP entry %q: %w", entry.Name, err)
		}
		destination, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0640)
		if err != nil {
			_ = source.Close()
			return fmt.Errorf("create config file %q: %w", relative, err)
		}
		copied, copyErr := io.Copy(destination, io.LimitReader(source, int64(entry.UncompressedSize64)+1))
		closeErr := destination.Close()
		sourceErr := source.Close()
		if copyErr != nil || closeErr != nil || sourceErr != nil || copied != int64(entry.UncompressedSize64) {
			return fmt.Errorf("extract config entry %q: archive data is incomplete or invalid", entry.Name)
		}
	}
	return normalizeModPermissions(destConfig)
}

func quarantinePath(cfg *agent.InstanceConfig, override string) (string, error) {
	return modStagePath("/var/lib/mastermind-agent/mod-quarantine", cfg, override)
}

func pendingPath(cfg *agent.InstanceConfig, override string) (string, error) {
	return modStagePath("/var/lib/mastermind-agent/mod-pending", cfg, override)
}

func modStagePath(base string, cfg *agent.InstanceConfig, override string) (string, error) {
	root, err := modsPath(cfg, override)
	if err != nil {
		return "", err
	}
	serverKey := cfg.ServerInstanceID
	if serverKey == "" {
		serverKey = filepath.Base(filepath.Dir(root))
	}
	return filepath.Join(base, serverKey), nil
}

type pendingRecommendation struct {
	RecommendedBy   string    `json:"recommendedBy"`
	RecommendedById string    `json:"recommendedById,omitempty"`
	OriginalName    string    `json:"originalName,omitempty"`
	Description     string    `json:"description,omitempty"`
	RecommendedAt   time.Time `json:"recommendedAt"`
}

func recommendationPath(root, folder string) string {
	return filepath.Join(root, folder, ".mastermind-recommendation.json")
}

func writeRecommendation(root, folder, recommendedBy, recommendedById, originalName, description string) error {
	record := pendingRecommendation{
		RecommendedBy:   strings.TrimSpace(recommendedBy),
		RecommendedById: strings.TrimSpace(recommendedById),
		OriginalName:    strings.TrimSpace(originalName),
		Description:     strings.TrimSpace(description),
		RecommendedAt:   time.Now().UTC(),
	}
	if record.RecommendedBy == "" {
		record.RecommendedBy = "Verified member"
	}
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(recommendationPath(root, folder), data, 0640)
}

func listPendingMods(root string) ([]modInfo, error) {
	mods, err := listModsAt(root)
	if err != nil {
		return nil, err
	}
	for index := range mods {
		data, err := os.ReadFile(recommendationPath(root, mods[index].Folder))
		if err != nil {
			continue
		}
		var record pendingRecommendation
		if json.Unmarshal(data, &record) != nil {
			continue
		}
		mods[index].RecommendedBy = record.RecommendedBy
		mods[index].OriginalName = record.OriginalName
		mods[index].Description = record.Description
		if record.Description != "" {
			mods[index].RecommendedBy = record.RecommendedBy + " — " + record.Description
		}
		if !record.RecommendedAt.IsZero() {
			mods[index].RecommendedAt = record.RecommendedAt.UTC().Format(time.RFC3339)
			mods[index].ActivatedAt = record.RecommendedAt.UTC()
		}
	}
	return mods, nil
}

func approvePendingMod(cfg *agent.InstanceConfig, override, folder string) error {
	pendingRoot, err := pendingPath(cfg, override)
	if err != nil {
		return err
	}
	source, err := realModDirectory(pendingRoot, folder)
	if err != nil {
		return fmt.Errorf("pending %w", err)
	}
	root, err := modsPath(cfg, override)
	if err != nil {
		return err
	}
	destination := filepath.Join(root, folder)
	if _, err := os.Lstat(destination); !os.IsNotExist(err) {
		return fmt.Errorf("active mod folder already exists: %s", folder)
	}
	if output, err := exec.Command("/usr/bin/mv", "--", source, destination).CombinedOutput(); err != nil {
		return fmt.Errorf("approve pending mod: %w: %s", err, strings.TrimSpace(string(output)))
	}
	_ = os.Remove(recommendationPath(root, folder))
	if err := normalizeModPermissions(destination); err != nil {
		return fmt.Errorf("make approved mod readable by game server: %w", err)
	}
	now := time.Now()
	if err := os.Chtimes(destination, now, now); err != nil {
		return fmt.Errorf("record approved mod activation time: %w", err)
	}
	marker := activationMarkerPath(cfg, override, folder)
	if err := os.MkdirAll(filepath.Dir(marker), 0750); err != nil {
		return fmt.Errorf("create mod activation state: %w", err)
	}
	if err := os.WriteFile(marker, []byte(now.UTC().Format(time.RFC3339Nano)+"\n"), 0640); err != nil {
		return fmt.Errorf("record mod activation state: %w", err)
	}
	return nil
}

func rejectPendingMod(cfg *agent.InstanceConfig, override, folder string) error {
	pendingRoot, err := pendingPath(cfg, override)
	if err != nil {
		return err
	}
	target, err := realModDirectory(pendingRoot, folder)
	if err != nil {
		return fmt.Errorf("pending %w", err)
	}
	if err := os.RemoveAll(target); err != nil {
		return fmt.Errorf("reject pending mod: %w", err)
	}
	return nil
}

func deleteQuarantinedMod(cfg *agent.InstanceConfig, override, folder string) error {
	quarantineRoot, err := quarantinePath(cfg, override)
	if err != nil {
		return err
	}
	target, err := realModDirectory(quarantineRoot, folder)
	if err != nil {
		return fmt.Errorf("quarantined %w", err)
	}
	if err := os.RemoveAll(target); err != nil {
		return fmt.Errorf("delete quarantined mod: %w", err)
	}
	_ = os.Remove(activationMarkerPath(cfg, override, folder))
	return nil
}

type restoreResult struct {
	RestoredAs     string `json:"restoredAs"`
	TransferConfig bool   `json:"transferConfig"`
	SourceFolder   string `json:"sourceFolder"`
}

func restoreMod(cfg *agent.InstanceConfig, override, folder string, forceOverride bool, transferConfigOverride *bool) (restoreResult, error) {
	empty := restoreResult{}
	root, err := modsPath(cfg, override)
	if err != nil {
		return empty, err
	}
	quarantineRoot, err := quarantinePath(cfg, override)
	if err != nil {
		return empty, err
	}
	source, err := realModDirectory(quarantineRoot, folder)
	if err != nil {
		return empty, fmt.Errorf("quarantined %w", err)
	}
	record := readQuarantineRecord(quarantineRoot, folder)
	targetFolder := record.TargetFolder
	if targetFolder == "" {
		targetFolder = folder
	}
	overrideActive := record.OverrideActive || forceOverride
	transferConfig := record.TransferConfig
	if transferConfigOverride != nil {
		transferConfig = *transferConfigOverride
	}
	if !overrideActive {
		transferConfig = false
	}
	var destination string
	if overrideActive {
		if err := removeActiveModFolder(root, targetFolder); err != nil {
			return empty, err
		}
		destination = filepath.Join(root, targetFolder)
	} else {
		nextFolder, err := nextAvailableModFolder(root, targetFolder)
		if err != nil {
			return empty, err
		}
		destination = filepath.Join(root, nextFolder)
	}
	_ = os.Remove(quarantineRecordPath(quarantineRoot, folder))
	if _, err := os.Lstat(destination); !os.IsNotExist(err) {
		return empty, fmt.Errorf("active mod folder already exists: %s", filepath.Base(destination))
	}
	if output, err := exec.Command("/usr/bin/mv", "--", source, destination).CombinedOutput(); err != nil {
		return empty, fmt.Errorf("restore mod: %w: %s", err, strings.TrimSpace(string(output)))
	}
	if err := normalizeModPermissions(destination); err != nil {
		return empty, fmt.Errorf("make restored mod readable by game server: %w", err)
	}
	now := time.Now()
	if err := os.Chtimes(destination, now, now); err != nil {
		return empty, fmt.Errorf("record restored mod activation time: %w", err)
	}
	restoredAs := filepath.Base(destination)
	marker := activationMarkerPath(cfg, override, restoredAs)
	if err := os.MkdirAll(filepath.Dir(marker), 0750); err != nil {
		return empty, fmt.Errorf("create mod activation state: %w", err)
	}
	if err := os.WriteFile(marker, []byte(now.UTC().Format(time.RFC3339Nano)+"\n"), 0640); err != nil {
		return empty, fmt.Errorf("record mod activation state: %w", err)
	}
	return restoreResult{
		RestoredAs:     restoredAs,
		TransferConfig: transferConfig,
		SourceFolder:   folder,
	}, nil
}

// Quarantine preserves the source tree's ownership and modes. Normalize the
// restored tree so the 7DTD service account can traverse folders and read mod
// files even when it reaches them through a supplemental group.
func normalizeModPermissions(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		if info.IsDir() {
			return os.Chmod(path, 0770)
		}
		return os.Chmod(path, 0660)
	})
}

type modInfo struct {
	Folder         string    `json:"folder"`
	Name           string    `json:"name"`
	Author         string    `json:"author,omitempty"`
	Website        string    `json:"website,omitempty"`
	Version        string    `json:"version,omitempty"`
	ActivatedAt    time.Time `json:"activatedAt"`
	PendingRestart bool      `json:"pendingRestart,omitempty"`
	ConfigFiles    []string  `json:"configFiles,omitempty"`
	RecommendedBy  string    `json:"recommendedBy,omitempty"`
	RecommendedAt  string    `json:"recommendedAt,omitempty"`
	OriginalName        string `json:"originalName,omitempty"`
	Description         string `json:"description,omitempty"`
	OverrideActive      bool   `json:"overrideActive,omitempty"`
	TransferConfig      bool   `json:"transferConfig,omitempty"`
	ConflictsWithActive bool   `json:"conflictsWithActive,omitempty"`
	RestoreTarget       string `json:"restoreTarget,omitempty"`
}

type serverAdmin struct {
	Platform        string `json:"platform,omitempty"`
	UserID          string `json:"userId"`
	Name            string `json:"name,omitempty"`
	PermissionLevel int    `json:"permissionLevel"`
}

func listServerAdmins(payload map[string]interface{}) ([]serverAdmin, error) {
	config, _ := payload["config"].(map[string]interface{})
	discovery, _ := config["discovery"].(map[string]interface{})
	path, _ := discovery["serverAdminPath"].(string)
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "." || !filepath.IsAbs(path) || !strings.EqualFold(filepath.Base(path), "serveradmin.xml") {
		return nil, fmt.Errorf("configured serveradmin.xml path required")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("read serveradmin.xml: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("serveradmin.xml must be a regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open serveradmin.xml: %w", err)
	}
	defer file.Close()
	admins := []serverAdmin{}
	decoder := xml.NewDecoder(file)
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("parse serveradmin.xml: %w", err)
		}
		start, ok := token.(xml.StartElement)
		if !ok || (!strings.EqualFold(start.Name.Local, "user") && !strings.EqualFold(start.Name.Local, "admin")) {
			continue
		}
		admin := serverAdmin{PermissionLevel: 0}
		for _, attribute := range start.Attr {
			switch strings.ToLower(attribute.Name.Local) {
			case "platform":
				admin.Platform = strings.TrimSpace(attribute.Value)
			case "userid", "steamid":
				admin.UserID = strings.TrimPrefix(strings.TrimSpace(attribute.Value), "Steam_")
			case "name":
				admin.Name = strings.TrimSpace(attribute.Value)
			case "permission_level":
				if level, parseErr := strconv.Atoi(strings.TrimSpace(attribute.Value)); parseErr == nil {
					admin.PermissionLevel = level
				}
			}
		}
		if admin.UserID != "" {
			admins = append(admins, admin)
		}
	}
	return admins, nil
}

func modsPath(cfg *agent.InstanceConfig, override string) (string, error) {
	path := override
	if path == "" {
		if cfg.InstallPath == "" {
			return "", fmt.Errorf("install_path required")
		}
		path = filepath.Join(cfg.InstallPath, "Mods")
	}
	return filepath.Clean(path), nil
}

func listMods(cfg *agent.InstanceConfig, override string) ([]modInfo, error) {
	root, err := modsPath(cfg, override)
	if err != nil {
		return nil, err
	}
	mods, err := listModsAt(root)
	if err != nil {
		return nil, err
	}
	for index := range mods {
		mods[index].PendingRestart = modPendingRestart(cfg, override, mods[index].Folder)
	}
	return mods, nil
}

// modPendingRestart marks a folder restored after the current game service
// start. The files are active on disk but 7DTD will not load them until its
// next restart, so the UI must distinguish this limbo state from loaded mods.
func activationMarkerPath(cfg *agent.InstanceConfig, override, folder string) string {
	root, err := quarantinePath(cfg, override)
	if err != nil {
		return ""
	}
	return filepath.Join(root, ".activation", folder+".txt")
}

func modPendingRestart(cfg *agent.InstanceConfig, override, folder string) bool {
	if cfg == nil || folder == "" {
		return false
	}
	marker := activationMarkerPath(cfg, override, folder)
	if marker == "" {
		return false
	}
	contents, err := os.ReadFile(marker)
	if err != nil {
		// Mods restored before activation markers were introduced are already
		// established installations; do not resurrect a stale queue warning
		// from their mutable folder timestamp.
		return false
	}
	activatedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(string(contents)))
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := exec.CommandContext(ctx, "/usr/bin/systemctl", "is-active", "--quiet", "7dtd.service").Run(); err != nil {
		return false
	}
	var started time.Time
	for _, property := range []string{"ActiveEnterTimestamp", "ExecMainStartTimestamp"} {
		out, showErr := exec.CommandContext(ctx, "/usr/bin/systemctl", "show", "-p", property, "--value", "7dtd.service").Output()
		if showErr != nil {
			continue
		}
		candidate, parseErr := parseSystemdTimestamp(strings.TrimSpace(string(out)))
		if parseErr == nil && candidate.After(started) {
			started = candidate
		}
	}
	if started.IsZero() {
		return false
	}
	if !activatedAt.After(started.Add(-2 * time.Second)) {
		// The server has started since this restore. Remove the marker so
		// subsequent restarts cannot be affected by mod-written timestamps.
		_ = os.Remove(marker)
		return false
	}
	return true
}

func parseSystemdTimestamp(value string) (time.Time, error) {
	for _, layout := range []string{
		"Mon 2006-01-02 15:04:05 MST",
		"Mon 2006-01-02 15:04:05 MST -0700",
		time.RFC3339,
	} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognized systemd timestamp %q", value)
}

func listModsAt(root string) ([]modInfo, error) {
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return []modInfo{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read mods directory: %w", err)
	}
	mods := make([]modInfo, 0, len(entries))
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if !entry.IsDir() {
			if info, err := os.Stat(filepath.Join(root, entry.Name())); err != nil || !info.IsDir() {
				continue
			}
		}
		info := modInfo{Folder: entry.Name(), Name: entry.Name()}
		if entryInfo, infoErr := entry.Info(); infoErr == nil {
			info.ActivatedAt = entryInfo.ModTime().UTC()
		}
		modInfoPath := filepath.Join(root, entry.Name(), "ModInfo.xml")
		if values, readErr := readModInfo(modInfoPath); readErr == nil {
			if values["name"] != "" {
				info.Name = values["name"]
			}
			info.Author = values["author"]
			info.Website = values["website"]
			if info.Website == "" {
				info.Website = values["url"]
			}
			info.Version = values["version"]
		}
		info.ConfigFiles = findModConfigFiles(root, entry.Name())
		mods = append(mods, info)
	}
	sort.Slice(mods, func(i, j int) bool { return strings.ToLower(mods[i].Name) < strings.ToLower(mods[j].Name) })
	return mods, nil
}

const maxModConfigBytes = 256 * 1024

var editableModConfigExtensions = map[string]bool{
	".cfg": true, ".conf": true, ".ini": true, ".json": true,
	".toml": true, ".txt": true, ".xml": true, ".yaml": true, ".yml": true,
}

func findModConfigFiles(modsRoot, folder string) []string {
	modRoot := filepath.Join(modsRoot, folder)
	files := collectModConfigFiles(modRoot, folder)
	sibling := filepath.Join(modsRoot, folder+"_Config")
	if info, err := os.Lstat(sibling); err == nil && info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		files = append(files, collectModConfigFiles(sibling, folder)...)
	}
	sort.Strings(files)
	return uniqueStrings(files)
}

func collectModConfigFiles(scanRoot, folder string) []string {
	modRoot := filepath.Join(filepath.Dir(scanRoot), folder)
	files := make([]string, 0)
	_ = filepath.Walk(scanRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil {
			return nil
		}
		if info.Mode()&os.ModeSymlink != 0 {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if info.IsDir() {
			name := strings.ToLower(info.Name())
			if path != scanRoot && (strings.HasPrefix(info.Name(), ".") || name == "logs" || name == "webapi") {
				return filepath.SkipDir
			}
			return nil
		}
		rel, relErr := filepath.Rel(modRoot, path)
		if relErr != nil || !isEditableModConfig(folder, rel) || info.Size() > maxModConfigBytes {
			return nil
		}
		files = append(files, filepath.ToSlash(rel))
		if len(files) >= 100 {
			return filepath.SkipAll
		}
		return nil
	})
	return files
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func siblingConfigPrefix(folder string) string {
	return "../" + folder + "_Config/"
}

func isEditableModConfig(folder, relativePath string) bool {
	clean := filepath.ToSlash(filepath.Clean(relativePath))
	if clean == "." || filepath.IsAbs(clean) {
		return false
	}
	ext := strings.ToLower(filepath.Ext(clean))
	if !editableModConfigExtensions[ext] {
		return false
	}
	base := strings.ToLower(filepath.Base(clean))
	if strings.HasPrefix(base, ".") || strings.HasSuffix(base, ".bak") {
		return false
	}
	if prefix := siblingConfigPrefix(folder); strings.HasPrefix(clean, prefix) {
		rest := strings.TrimPrefix(clean, prefix)
		return rest != "" && !strings.Contains(rest, "..")
	}
	if strings.Contains(clean, "..") {
		return false
	}
	parts := strings.Split(clean, "/")
	if len(parts) > 1 && strings.EqualFold(parts[0], "Config") {
		return true
	}
	return strings.Contains(base, "config") || strings.Contains(base, "settings")
}

func resolveModConfig(root, folder, relativePath string) (string, error) {
	return resolveModConfigPath(root, folder, relativePath, false)
}

// resolveModConfigPath validates an editable mod config path. When allowMissing
// is true (merge apply of brand-new template files), the target need not exist yet.
func resolveModConfigPath(root, folder, relativePath string, allowMissing bool) (string, error) {
	modRoot, err := realModDirectory(root, folder)
	if err != nil {
		return "", err
	}
	clean := filepath.Clean(strings.TrimSpace(relativePath))
	if !isEditableModConfig(folder, clean) {
		return "", fmt.Errorf("invalid or unsupported mod config path")
	}
	target := filepath.Clean(filepath.Join(modRoot, clean))
	if !pathInside(root, target) {
		return "", fmt.Errorf("mod config path is outside Mods")
	}
	slashRel := filepath.ToSlash(clean)
	if strings.HasPrefix(slashRel, siblingConfigPrefix(folder)) {
		if !pathInside(filepath.Join(root, folder+"_Config"), target) {
			return "", fmt.Errorf("mod config path is outside the runtime config folder")
		}
	} else if !pathInside(modRoot, target) {
		return "", fmt.Errorf("mod config path is outside the mod folder")
	}
	info, err := os.Lstat(target)
	if err != nil {
		if allowMissing && os.IsNotExist(err) {
			return target, nil
		}
		return "", fmt.Errorf("mod config not found: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("mod config must be a regular file")
	}
	if info.Size() > maxModConfigBytes {
		return "", fmt.Errorf("mod config exceeds 256 KiB editor limit")
	}
	return target, nil
}

func pathInside(root, target string) bool {
	root = filepath.Clean(root)
	target = filepath.Clean(target)
	sep := string(filepath.Separator)
	return target == root || strings.HasPrefix(target, root+sep)
}

func readModConfig(cfg *agent.InstanceConfig, override, folder, relativePath string) (string, error) {
	root, err := modsPath(cfg, override)
	if err != nil {
		return "", err
	}
	target, err := resolveModConfig(root, folder, relativePath)
	if err != nil {
		return "", err
	}
	content, err := os.ReadFile(target)
	if err != nil {
		return "", fmt.Errorf("read mod config: %w", err)
	}
	return string(content), nil
}

// previewConfigMerge reads config files from both a quarantined source mod
// and a live active target mod, then produces a template-safe merged preview
// for each file. It does not write anything.
func previewConfigMerge(cfg *agent.InstanceConfig, override, sourceFolder, targetFolder string) ([]configmerge.MergeResult, error) {
	if sourceFolder == "" || targetFolder == "" {
		return nil, fmt.Errorf("sourceFolder and targetFolder are required")
	}
	activeRoot, err := modsPath(cfg, override)
	if err != nil {
		return nil, err
	}
	quarantineRoot, err := quarantinePath(cfg, override)
	if err != nil {
		return nil, err
	}
	return previewConfigMergeAt(activeRoot, quarantineRoot, sourceFolder, targetFolder)
}

// previewConfigMergeAt compares quarantined templates against live active configs.
func previewConfigMergeAt(activeRoot, quarantineRoot, sourceFolder, targetFolder string) ([]configmerge.MergeResult, error) {
	// Discover config files from the active (target) mod — these are the live files
	liveConfigFiles := findModConfigFiles(activeRoot, targetFolder)
	// Discover config files from the quarantined (source) mod — these are the templates
	templateConfigFiles := findModConfigFiles(quarantineRoot, sourceFolder)

	// Build a set of template paths for quick lookup
	templateSet := make(map[string]bool, len(templateConfigFiles))
	for _, p := range templateConfigFiles {
		templateSet[p] = true
	}

	// Union of all paths: template files + live files
	allPaths := make(map[string]bool)
	for _, p := range templateConfigFiles {
		allPaths[p] = true
	}
	for _, p := range liveConfigFiles {
		allPaths[p] = true
	}

	results := make([]configmerge.MergeResult, 0, len(allPaths))
	for path := range allPaths {
		templateContent := ""
		liveContent := ""

		// Read template from quarantine
		if templateSet[path] {
			resolved, resolveErr := resolveModConfig(quarantineRoot, sourceFolder, path)
			if resolveErr == nil {
				data, readErr := os.ReadFile(resolved)
				if readErr == nil {
					templateContent = string(data)
				}
			}
		}

		// Read live from active
		liveResolved, liveResolveErr := resolveModConfig(activeRoot, targetFolder, path)
		if liveResolveErr == nil {
			data, readErr := os.ReadFile(liveResolved)
			if readErr == nil {
				liveContent = string(data)
			}
		}

		if templateContent == "" && liveContent == "" {
			continue
		}
		if templateContent == "" {
			// Live file has no counterpart in new mod
			results = append(results, configmerge.MergeResult{
				Path:          path,
				MergedContent: liveContent,
				ParseFormat:   "text",
				Warning:       "live file has no counterpart in new mod; will not be modified",
				Skipped:       true,
			})
			continue
		}
		if liveContent == "" {
			// Template exists but live doesn't — write template defaults
			results = append(results, configmerge.MergeResult{
				Path:            path,
				MergedContent:   templateContent,
				TemplateContent: templateContent,
				ParseFormat:     "text",
				Warning:         "new config file from updated mod (no existing live file)",
				Stats:           configmerge.MergeStats{NewKeys: configmerge.CountNonEmptyLines(templateContent)},
			})
			continue
		}

		// Both exist: merge
		result := configmerge.MergeFile(path, templateContent, liveContent)
		result.TemplateContent = templateContent
		results = append(results, result)
	}

	return results, nil
}

func modConfigFileWritable(target string) bool {
	file, err := os.OpenFile(target, os.O_WRONLY, 0)
	if err != nil {
		return false
	}
	_ = file.Close()
	return true
}

func modConfigDirectoryWritable(dir string) bool {
	probe, err := os.CreateTemp(dir, ".mastermind-write-probe-*")
	if err != nil {
		return false
	}
	probePath := probe.Name()
	_ = probe.Close()
	_ = os.Remove(probePath)
	return true
}

func ensureModConfigWritable(target string) error {
	if modConfigFileWritable(target) {
		return nil
	}
	cmd := exec.Command("sudo", "/usr/local/sbin/mastermind-ensure-mod-config-writable", target)
	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = "permission repair failed"
		}
		return fmt.Errorf("mod config is not writable by the agent (%s): %w", message, err)
	}
	if !modConfigFileWritable(target) {
		return fmt.Errorf("mod config is still not writable after permission repair")
	}
	return nil
}

func writeModConfigFile(target string, content string, mode os.FileMode) error {
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err = file.WriteString(content); err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	return err
}

func writeModConfig(cfg *agent.InstanceConfig, override, folder, relativePath, content string) error {
	if len(content) > maxModConfigBytes {
		return fmt.Errorf("mod config exceeds 256 KiB editor limit")
	}
	root, err := modsPath(cfg, override)
	if err != nil {
		return err
	}
	target, err := resolveModConfigPath(root, folder, relativePath, true)
	if err != nil {
		return err
	}
	targetDir := filepath.Dir(target)
	mode := os.FileMode(0660)
	info, statErr := os.Stat(target)
	if statErr == nil {
		mode = info.Mode().Perm()
	} else if os.IsNotExist(statErr) {
		if err := os.MkdirAll(targetDir, 0770); err != nil {
			return fmt.Errorf("create mod config directory: %w", err)
		}
		if writeErr := os.WriteFile(target, []byte(content), mode); writeErr != nil {
			if ensureErr := ensureModConfigWritable(target); ensureErr != nil {
				return fmt.Errorf("create mod config: %w", writeErr)
			}
			if writeErr = os.WriteFile(target, []byte(content), mode); writeErr != nil {
				return fmt.Errorf("create mod config: %w", writeErr)
			}
		}
		return nil
	} else {
		return fmt.Errorf("stat mod config: %w", statErr)
	}
	if err := ensureModConfigWritable(target); err != nil {
		return err
	}
	if modConfigDirectoryWritable(targetDir) {
		temporary, tempErr := os.CreateTemp(targetDir, ".mastermind-config-*")
		if tempErr == nil {
			temporaryPath := temporary.Name()
			defer os.Remove(temporaryPath)
			if _, err = temporary.WriteString(content); err == nil {
				err = temporary.Sync()
			}
			if closeErr := temporary.Close(); err == nil {
				err = closeErr
			}
			if err != nil {
				return fmt.Errorf("write temporary mod config: %w", err)
			}
			if err = os.Chmod(temporaryPath, mode); err != nil {
				return fmt.Errorf("preserve mod config permissions: %w", err)
			}
			if err = os.Rename(temporaryPath, target); err == nil {
				return nil
			}
		}
	}
	if err := writeModConfigFile(target, content, mode); err != nil {
		return fmt.Errorf("write mod config: %w", err)
	}
	return nil
}

func configuredServerConfigPath(cfg *agent.InstanceConfig, payload map[string]interface{}) (string, error) {
	config, _ := payload["config"].(map[string]interface{})
	discovery, _ := config["discovery"].(map[string]interface{})
	path, _ := discovery["serverConfigPath"].(string)
	path = strings.TrimSpace(path)
	if path == "" && cfg != nil && cfg.InstallPath != "" {
		path = filepath.Join(filepath.Dir(cfg.InstallPath), "serverconfig.xml")
	}
	path = filepath.Clean(path)
	if path == "." || !filepath.IsAbs(path) || (!strings.EqualFold(filepath.Base(path), "serverconfig.xml") && !strings.EqualFold(filepath.Base(path), "sdtdserver.xml")) {
		return "", fmt.Errorf("configured 7DTD server config path required")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "", fmt.Errorf("read server config: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("server config must be a real file")
	}
	return path, nil
}

func readConfiguredServerConfig(cfg *agent.InstanceConfig, payload map[string]interface{}) (string, string, error) {
	path, err := configuredServerConfigPath(cfg, payload)
	if err != nil {
		return "", "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", fmt.Errorf("read server config: %w", err)
	}
	if len(data) > maxModConfigBytes {
		return "", "", fmt.Errorf("server config exceeds 256 KiB editor limit")
	}
	return string(data), path, nil
}

func writeConfiguredServerConfig(cfg *agent.InstanceConfig, payload map[string]interface{}, content string) (string, error) {
	if len(content) > maxModConfigBytes {
		return "", fmt.Errorf("server config exceeds 256 KiB editor limit")
	}
	path, err := configuredServerConfigPath(cfg, payload)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("stat server config: %w", err)
	}
	if err := writeModConfigFile(path, content, info.Mode().Perm()); err != nil {
		return "", fmt.Errorf("write server config: %w", err)
	}
	return path, nil
}

func readModInfo(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	values := make(map[string]string)
	decoder := xml.NewDecoder(f)
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		key := strings.ToLower(start.Name.Local)
		if key != "name" && key != "author" && key != "website" && key != "url" && key != "version" {
			continue
		}
		for _, attr := range start.Attr {
			if strings.EqualFold(attr.Name.Local, "value") {
				values[key] = strings.TrimSpace(attr.Value)
				break
			}
		}
		if values[key] == "" {
			var text string
			if err := decoder.DecodeElement(&text, &start); err == nil {
				values[key] = strings.TrimSpace(text)
			}
		}
	}
	return values, nil
}

func deleteModWithPipe(ctx context.Context, cfg *agent.InstanceConfig, override, folder string) error {
	root, err := modsPath(cfg, override)
	if err != nil {
		return err
	}
	target, err := realModDirectory(root, folder)
	if err != nil {
		return err
	}
	// Positional shell arguments prevent command injection while retaining the requested Linux pipe.
	const script = `find "$1" -mindepth 1 -maxdepth 1 -type d -name "$2" -print0 | xargs -0 -r rm -rf --`
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", script, "mod-delete", root, folder)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("delete mod: %w: %s", err, strings.TrimSpace(string(output)))
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		return fmt.Errorf("mod folder still exists after delete")
	}
	_ = os.Remove(activationMarkerPath(cfg, override, folder))
	return nil
}

func resultOrErr(err error) (agent.JobResult, error) {
	if err != nil {
		return agent.JobResult{Status: "failed", Error: err.Error()}, nil
	}
	return agent.JobResult{Status: "success"}, nil
}

func jobPayloadToConfig(p map[string]interface{}) *agent.InstanceConfig {
	if p == nil {
		return &agent.InstanceConfig{}
	}
	cfg := &agent.InstanceConfig{
		ServerInstanceID:      getString(p, "server_instance_id", ""),
		InstallPath:           getString(p, "install_path", ""),
		StartCommand:          getString(p, "start_command", ""),
		StopCommand:           getString(p, "stop_command", ""),
		TelnetHost:            getString(p, "telnet_host", "127.0.0.1"),
		TelnetPort:            getInt(p, "telnet_port", 8081),
		TelnetPassword:        getString(p, "telnet_password", ""),
		AvoidBloodMoonRestart: getBool(p, "avoid_blood_moon_restart"),
	}
	return cfg
}

func getString(m map[string]interface{}, key, def string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return def
}

func getInt(m map[string]interface{}, key string, def int) int {
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return def
}

func getBool(m map[string]interface{}, key string) bool {
	v, _ := m[key].(bool)
	return v
}

type serverProperty struct {
	Name  string `xml:"name,attr"`
	Value string `xml:"value,attr"`
}

type serverConfiguration struct {
	Properties []serverProperty `xml:"property"`
}

const saveBackupRoot = "/opt/regionhealer/RegionAutoFix/Saves"
const regionHealerConfigPath = "/opt/regionhealer/RegionAutoFix/config.env"
const regionHealerPolicyPath = "/opt/regionhealer/RegionAutoFix/Saves/.mastermind-policy.env"

func regionHealerEnvValue(data, key, fallback string) string {
	pattern := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(key) + `=["']?([^"'\r\n]*)["']?\s*$`)
	match := pattern.FindStringSubmatch(data)
	if len(match) != 2 || strings.TrimSpace(match[1]) == "" {
		return fallback
	}
	return strings.TrimSpace(match[1])
}

func setRegionHealerEnvValue(data, key, value string) string {
	line := fmt.Sprintf(`%s="%s"`, key, value)
	pattern := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(key) + `=.*$`)
	if pattern.MatchString(data) {
		return pattern.ReplaceAllString(data, line)
	}
	if data != "" && !strings.HasSuffix(data, "\n") {
		data += "\n"
	}
	return data + line + "\n"
}

func countRegionHealerSnapshots() (int, error) {
	entries, err := os.ReadDir(saveBackupRoot)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, entry := range entries {
		if entry.IsDir() && regexp.MustCompile(`^snap_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$`).MatchString(entry.Name()) {
			count++
		}
	}
	return count, nil
}

func pruneRegionHealerSnapshots(retain int) error {
	entries, err := os.ReadDir(saveBackupRoot)
	if err != nil {
		return err
	}
	ids := make([]string, 0)
	pattern := regexp.MustCompile(`^snap_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$`)
	for _, entry := range entries {
		if entry.IsDir() && pattern.MatchString(entry.Name()) {
			ids = append(ids, entry.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(ids)))
	for _, id := range ids[minimum(retain, len(ids)):] {
		if err := os.RemoveAll(filepath.Join(saveBackupRoot, id)); err != nil {
			return fmt.Errorf("remove old Region Healer snapshot %s: %w", id, err)
		}
	}
	return nil
}

func minimum(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func regionHealerSettings(ctx context.Context) (map[string]interface{}, error) {
	data, err := os.ReadFile(regionHealerConfigPath)
	if err != nil {
		return nil, fmt.Errorf("read Region Healer settings: %w", err)
	}
	count, err := countRegionHealerSnapshots()
	if err != nil {
		return nil, fmt.Errorf("count Region Healer snapshots: %w", err)
	}
	policy, _ := os.ReadFile(regionHealerPolicyPath)
	configured := string(policy)
	if configured == "" {
		configured = string(data)
	}
	return map[string]interface{}{
		"backupTime":     regionHealerEnvValue(configured, "backup_time", "03:00"),
		"timezone":       regionHealerEnvValue(configured, "backup_timezone", "America/New_York"),
		"retentionCount": 1,
		"snapshotCount":  count,
		"active":         serviceActive(ctx, "regionhealer.service"),
	}, nil
}

func configureRegionHealer(ctx context.Context, backupTime string) (map[string]interface{}, error) {
	policy, _ := os.ReadFile(regionHealerPolicyPath)
	updated := setRegionHealerEnvValue(string(policy), "backup_time", backupTime)
	updated = setRegionHealerEnvValue(updated, "backup_timezone", "America/New_York")
	updated = setRegionHealerEnvValue(updated, "savecount", "1")
	temporary := regionHealerPolicyPath + ".tmp"
	if err := os.WriteFile(temporary, []byte(updated), 0644); err != nil {
		return nil, fmt.Errorf("stage Region Healer policy: %w", err)
	}
	if err := os.Rename(temporary, regionHealerPolicyPath); err != nil {
		_ = os.Remove(temporary)
		return nil, fmt.Errorf("activate Region Healer policy: %w", err)
	}
	if err := pruneRegionHealerSnapshots(1); err != nil {
		return nil, err
	}
	if serviceActive(ctx, "regionhealer.service") {
		if err := systemctlService(ctx, "stop", "regionhealer.service"); err != nil {
			return nil, fmt.Errorf("stop Region Healer to apply settings: %w", err)
		}
		if err := systemctlService(ctx, "start", "regionhealer.service"); err != nil {
			return nil, fmt.Errorf("restart Region Healer after applying settings: %w", err)
		}
	}
	return regionHealerSettings(ctx)
}

type SaveRecord struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	GameDay   int       `json:"gameDay"`
	Kind      string    `json:"kind"`
	SizeBytes int64     `json:"sizeBytes"`
}

type saveMetadata struct {
	CreatedAt time.Time `json:"createdAt"`
	GameDay   int       `json:"gameDay"`
	Kind      string    `json:"kind"`
}

func resolveLiveSave(cfg *agent.InstanceConfig, configOverride string) (string, error) {
	configPath := configOverride
	if configPath == "" {
		configPath = filepath.Join(filepath.Dir(cfg.InstallPath), "serverconfig.xml")
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		return "", fmt.Errorf("read server configuration: %w", err)
	}
	var parsed serverConfiguration
	if err := xml.Unmarshal(data, &parsed); err != nil {
		return "", fmt.Errorf("parse server configuration: %w", err)
	}
	properties := make(map[string]string)
	for _, property := range parsed.Properties {
		properties[property.Name] = strings.TrimSpace(property.Value)
	}
	world, game := properties["GameWorld"], properties["GameName"]
	userData := properties["UserDataFolder"]
	if userData == "" {
		userData = filepath.Join(filepath.Dir(cfg.InstallPath), "userdata")
	}
	if world == "" || game == "" || filepath.Base(world) != world || filepath.Base(game) != game {
		return "", fmt.Errorf("safe GameWorld and GameName are required")
	}
	savesRoot := filepath.Clean(filepath.Join(userData, "Saves"))
	target := filepath.Clean(filepath.Join(savesRoot, world, game))
	rel, err := filepath.Rel(savesRoot, target)
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("resolved save path is outside Saves")
	}
	return target, nil
}

type maintenanceState struct {
	Enabled          bool   `json:"enabled"`
	PreviousPassword string `json:"previousPassword"`
}

func maintenanceStatePath(cfg *agent.InstanceConfig) string {
	id := strings.TrimSpace(cfg.ServerInstanceID)
	if id == "" {
		id = "default"
	}
	return filepath.Join("/var/lib/mastermind-agent/maintenance", id+".json")
}

func applyMaintenancePassword(cfg *agent.InstanceConfig, enabled bool, password string) error {
	configPath := filepath.Join(filepath.Dir(cfg.InstallPath), "serverconfig.xml")
	current, err := readServerConfigProperty(configPath, "ServerPassword")
	if err != nil {
		return err
	}
	stateFile := maintenanceStatePath(cfg)
	if enabled {
		if password == "" {
			return fmt.Errorf("maintenance password is required")
		}
		state := maintenanceState{Enabled: true, PreviousPassword: current}
		if existing, err := os.ReadFile(stateFile); err == nil {
			var previous maintenanceState
			if json.Unmarshal(existing, &previous) == nil && previous.Enabled {
				state.PreviousPassword = previous.PreviousPassword
			}
		}
		if err := os.MkdirAll(filepath.Dir(stateFile), 0750); err != nil {
			return fmt.Errorf("create maintenance state: %w", err)
		}
		data, _ := json.Marshal(state)
		if err := os.WriteFile(stateFile, data, 0640); err != nil {
			return fmt.Errorf("write maintenance state: %w", err)
		}
		return writeServerConfigProperty(configPath, "ServerPassword", password)
	}
	previous := ""
	if existing, err := os.ReadFile(stateFile); err == nil {
		var state maintenanceState
		if json.Unmarshal(existing, &state) == nil {
			previous = state.PreviousPassword
		}
	}
	if err := writeServerConfigProperty(configPath, "ServerPassword", previous); err != nil {
		return err
	}
	_ = os.Remove(stateFile)
	return nil
}

func readServerConfigProperty(path, name string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read server configuration: %w", err)
	}
	pattern := regexp.MustCompile(`(?i)<property\s+name="` + regexp.QuoteMeta(name) + `"\s+value="([^"]*)"`)
	match := pattern.FindSubmatch(data)
	if len(match) == 2 {
		return string(match[1]), nil
	}
	return "", nil
}

func writeServerConfigProperty(path, name, value string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read server configuration: %w", err)
	}
	escaped := escapeXMLAttr(value)
	pattern := regexp.MustCompile(`(?i)(<property\s+name="` + regexp.QuoteMeta(name) + `"\s+value=")[^"]*(")`)
	updated := data
	if pattern.Match(data) {
		updated = pattern.ReplaceAll(data, []byte(`${1}`+escaped+`${2}`))
	} else {
		insert := []byte("\t<property name=\"" + name + "\" value=\"" + escaped + "\"/>\n")
		closing := []byte("</ServerSettings>")
		idx := bytes.LastIndex(bytes.ToLower(data), bytes.ToLower(closing))
		if idx < 0 {
			return fmt.Errorf("server configuration is missing </ServerSettings>")
		}
		updated = append([]byte{}, data[:idx]...)
		updated = append(updated, insert...)
		updated = append(updated, data[idx:]...)
	}
	tmp := path + ".mastermind-tmp"
	if err := os.WriteFile(tmp, updated, 0640); err != nil {
		return fmt.Errorf("write server configuration: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("replace server configuration: %w", err)
	}
	return nil
}

func escapeXMLAttr(value string) string {
	replacer := strings.NewReplacer(`&`, "&amp;", `<`, "&lt;", `>`, "&gt;", `"`, "&quot;", `'`, "&apos;")
	return replacer.Replace(value)
}

func validSaveID(id string) bool {
	if filepath.Base(id) != id {
		return false
	}
	matched, _ := regexp.MatchString(`^(mastermind|snap)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$`, id)
	return matched
}

func saveBackupPath(id string) (string, error) {
	if !validSaveID(id) {
		return "", fmt.Errorf("invalid save ID")
	}
	return filepath.Join(saveBackupRoot, id), nil
}

func directorySize(root string) int64 {
	var total int64
	_ = filepath.Walk(root, func(_ string, info os.FileInfo, err error) error {
		if err == nil && info.Mode().IsRegular() {
			total += info.Size()
		}
		return nil
	})
	return total
}

func copySaveTree(source, destination string, skipMetadata bool) error {
	return filepath.Walk(source, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if skipMetadata && rel == ".mastermind-save.json" {
			return nil
		}
		target := filepath.Join(destination, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		return copySaveFile(path, target, info.Mode().Perm())
	})
}

func copySaveFile(source, destination string, mode os.FileMode) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		_ = in.Close()
		return err
	}
	_, copyErr := io.Copy(out, in)
	inErr := in.Close()
	outErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if inErr != nil {
		return inErr
	}
	return outErr
}

func (a *Adapter) ListSaves(cfg *agent.InstanceConfig, configOverride string) ([]SaveRecord, error) {
	if _, err := resolveLiveSave(cfg, configOverride); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(saveBackupRoot)
	if err != nil {
		return nil, fmt.Errorf("read save backups: %w", err)
	}
	saves := make([]SaveRecord, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || !validSaveID(entry.Name()) {
			continue
		}
		path := filepath.Join(saveBackupRoot, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}
		record := SaveRecord{ID: entry.Name(), CreatedAt: info.ModTime().UTC(), Kind: "region-healer", SizeBytes: directorySize(path)}
		if data, err := os.ReadFile(filepath.Join(path, ".mastermind-save.json")); err == nil {
			var metadata saveMetadata
			if json.Unmarshal(data, &metadata) == nil {
				record.CreatedAt, record.GameDay, record.Kind = metadata.CreatedAt, metadata.GameDay, metadata.Kind
			}
		}
		saves = append(saves, record)
	}
	sort.Slice(saves, func(i, j int) bool { return saves[i].CreatedAt.After(saves[j].CreatedAt) })
	return saves, nil
}

func (a *Adapter) BackupSave(ctx context.Context, cfg *agent.InstanceConfig, configOverride string, retention int) (SaveRecord, error) {
	live, err := resolveLiveSave(cfg, configOverride)
	if err != nil {
		return SaveRecord{}, err
	}
	if info, err := os.Stat(live); err != nil || !info.IsDir() {
		return SaveRecord{}, fmt.Errorf("live save is unavailable")
	}
	gameDay := 0
	if serviceActive(ctx, "7dtd.service") {
		if _, err := a.SendCommand(ctx, cfg, "saveworld"); err != nil {
			return SaveRecord{}, fmt.Errorf("flush world before backup: %w", err)
		}
		time.Sleep(2 * time.Second)
		if output, err := a.SendCommand(ctx, cfg, "gettime"); err == nil {
			if match := gameDayPattern.FindStringSubmatch(output); len(match) == 2 {
				gameDay, _ = strconv.Atoi(match[1])
			}
		}
	}
	created := time.Now().UTC()
	id := "mastermind_" + created.Format("2006-01-02_15-04-05")
	destination, _ := saveBackupPath(id)
	if err := os.MkdirAll(saveBackupRoot, 0750); err != nil {
		return SaveRecord{}, fmt.Errorf("create backup root: %w", err)
	}
	if _, err := os.Lstat(destination); !os.IsNotExist(err) {
		return SaveRecord{}, fmt.Errorf("backup ID already exists; try again in one second")
	}
	if err := copySaveTree(live, destination, false); err != nil {
		_ = os.RemoveAll(destination)
		return SaveRecord{}, fmt.Errorf("copy world save: %w", err)
	}
	metadata := saveMetadata{CreatedAt: created, GameDay: gameDay, Kind: "full-world"}
	data, _ := json.MarshalIndent(metadata, "", "  ")
	if err := os.WriteFile(filepath.Join(destination, ".mastermind-save.json"), data, 0640); err != nil {
		_ = os.RemoveAll(destination)
		return SaveRecord{}, fmt.Errorf("write backup metadata: %w", err)
	}
	if retention < 1 {
		retention = 1
	}
	if retention > 100 {
		retention = 100
	}
	record := SaveRecord{ID: id, CreatedAt: created, GameDay: gameDay, Kind: metadata.Kind, SizeBytes: directorySize(destination)}
	// Retention is housekeeping, not part of creating the backup. Older
	// RegionHealer snapshots may be owned by another service account. Failing a
	// safe restart after saveworld and a successful backup leaves players seeing
	// the full countdown while the server never restarts. Keep the valid backup
	// and let an explicit policy-cleanup job report any ownership problem.
	_ = pruneFullSaveBackups(retention)
	return record, nil
}

func pruneFullSaveBackups(retention int) error {
	entries, err := os.ReadDir(saveBackupRoot)
	if err != nil {
		return err
	}
	ids := make([]string, 0)
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "mastermind_") && validSaveID(entry.Name()) {
			ids = append(ids, entry.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(ids)))
	if len(ids) <= retention {
		return nil
	}
	for _, id := range ids[retention:] {
		path, _ := saveBackupPath(id)
		if err := os.RemoveAll(path); err != nil {
			return err
		}
	}
	return nil
}

func (a *Adapter) RestoreSave(ctx context.Context, cfg *agent.InstanceConfig, configOverride, id string) (SaveRecord, error) {
	if serviceActive(ctx, "7dtd.service") {
		return SaveRecord{}, fmt.Errorf("server must be stopped before restoring a save")
	}
	live, err := resolveLiveSave(cfg, configOverride)
	if err != nil {
		return SaveRecord{}, err
	}
	source, err := saveBackupPath(id)
	if err != nil {
		return SaveRecord{}, err
	}
	info, err := os.Lstat(source)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return SaveRecord{}, fmt.Errorf("save backup not found")
	}
	if serviceActive(ctx, "regionhealer.service") {
		if err := systemctlService(ctx, "stop", "regionhealer.service"); err != nil {
			return SaveRecord{}, fmt.Errorf("stop Region Healer before restore: %w", err)
		}
	}
	saves, err := a.ListSaves(cfg, configOverride)
	if err != nil {
		return SaveRecord{}, err
	}
	var selected SaveRecord
	for _, save := range saves {
		if save.ID == id {
			selected = save
			break
		}
	}
	if selected.ID == "" {
		return SaveRecord{}, fmt.Errorf("save backup not found")
	}
	fullWorld := selected.Kind == "full-world"
	target := live
	copySource := source
	if !fullWorld {
		target = filepath.Join(live, "Region")
		copySource = filepath.Join(source, "Region")
		if info, err := os.Stat(copySource); err != nil || !info.IsDir() {
			return SaveRecord{}, fmt.Errorf("Region Healer snapshot has no Region directory")
		}
	}
	old := target + ".mastermind-restore-old"
	configPath := configOverride
	if configPath == "" {
		configPath = filepath.Join(filepath.Dir(cfg.InstallPath), "serverconfig.xml")
	}
	if _, err := os.Lstat(old); err == nil {
		if err := removeRestoreRollback(ctx, configPath, old); err != nil {
			return SaveRecord{}, fmt.Errorf("clean stale restore rollback: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return SaveRecord{}, fmt.Errorf("inspect stale restore rollback: %w", err)
	}
	if _, err := os.Stat(target); err == nil {
		if err := os.Rename(target, old); err != nil {
			return SaveRecord{}, fmt.Errorf("stage current save: %w", err)
		}
	}
	if err := copySaveTree(copySource, target, fullWorld); err != nil {
		_ = os.RemoveAll(target)
		_ = os.Rename(old, target)
		return SaveRecord{}, fmt.Errorf("restore save: %w", err)
	}
	if err := makeTreeGroupWritable(target); err != nil {
		_ = os.RemoveAll(target)
		_ = os.Rename(old, target)
		return SaveRecord{}, fmt.Errorf("set restored save permissions: %w", err)
	}
	if fullWorld {
		output, err := exec.CommandContext(ctx, "/usr/bin/sudo", "-n", "/usr/local/sbin/mastermind-fix-7dtd-save-permissions", configPath, target).CombinedOutput()
		if err != nil {
			_ = os.RemoveAll(target)
			_ = os.Rename(old, target)
			return SaveRecord{}, fmt.Errorf("assign restored save to game account: %w: %s", err, strings.TrimSpace(string(output)))
		}
	}
	if err := removeRestoreRollback(ctx, configPath, old); err != nil {
		return SaveRecord{}, fmt.Errorf("remove restore rollback after successful copy: %w", err)
	}
	return selected, nil
}

func removeRestoreRollback(ctx context.Context, configPath, old string) error {
	output, err := exec.CommandContext(ctx, "/usr/bin/sudo", "-n", "/usr/local/sbin/mastermind-wipe-7dtd-save", configPath, old).CombinedOutput()
	if err != nil {
		return fmt.Errorf("delete validated rollback directory: %w: %s", err, strings.TrimSpace(string(output)))
	}
	if _, err := os.Lstat(old); !os.IsNotExist(err) {
		return fmt.Errorf("rollback directory still exists after deletion")
	}
	return nil
}

func makeTreeGroupWritable(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		mode := info.Mode().Perm()
		if info.IsDir() {
			mode |= 0070
		} else if info.Mode().IsRegular() {
			mode |= 0060
		}
		return os.Chmod(path, mode)
	})
}

func (a *Adapter) DeleteSaveBackup(ctx context.Context, id string) error {
	path, err := saveBackupPath(id)
	if err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("save backup not found")
	}
	healerWasActive := serviceActive(ctx, "regionhealer.service")
	gameWasActive := serviceActive(ctx, "7dtd.service")
	if healerWasActive {
		if err := systemctlService(ctx, "stop", "regionhealer.service"); err != nil {
			return fmt.Errorf("pause Region Healer before deletion: %w", err)
		}
		if gameWasActive {
			defer func() { _ = systemctlService(context.Background(), "start", "regionhealer.service") }()
		}
	}
	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("delete save backup: %w", err)
	}
	return nil
}

func serviceActive(ctx context.Context, service string) bool {
	return exec.CommandContext(ctx, "/usr/bin/systemctl", "is-active", "--quiet", service).Run() == nil
}

func (a *Adapter) WipeSave(ctx context.Context, cfg *agent.InstanceConfig, configOverride string) (string, error) {
	configPath := configOverride
	if configPath == "" {
		configPath = filepath.Join(filepath.Dir(cfg.InstallPath), "serverconfig.xml")
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		return "", fmt.Errorf("read server configuration: %w", err)
	}
	var parsed serverConfiguration
	if err := xml.Unmarshal(data, &parsed); err != nil {
		return "", fmt.Errorf("parse server configuration: %w", err)
	}
	properties := make(map[string]string)
	for _, property := range parsed.Properties {
		properties[property.Name] = strings.TrimSpace(property.Value)
	}
	world, game := properties["GameWorld"], properties["GameName"]
	userData := properties["UserDataFolder"]
	if userData == "" {
		userData = filepath.Join(filepath.Dir(cfg.InstallPath), "userdata")
	}
	if world == "" || game == "" || filepath.Base(world) != world || filepath.Base(game) != game {
		return "", fmt.Errorf("safe GameWorld and GameName are required")
	}
	savesRoot := filepath.Clean(filepath.Join(userData, "Saves"))
	target := filepath.Clean(filepath.Join(savesRoot, world, game))
	rel, err := filepath.Rel(savesRoot, target)
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("resolved save path is outside Saves")
	}
	_, targetErr := os.Lstat(target)
	if targetErr != nil && !os.IsNotExist(targetErr) {
		return "", fmt.Errorf("save path unavailable: %w", targetErr)
	}
	healerWasActive := exec.CommandContext(ctx, "/usr/bin/systemctl", "is-active", "--quiet", "regionhealer.service").Run() == nil
	if healerWasActive {
		if err := systemctlService(ctx, "stop", "regionhealer.service"); err != nil {
			return "", fmt.Errorf("pause RegionHealer: %w", err)
		}
		defer func() { _ = systemctlService(context.Background(), "start", "regionhealer.service") }()
	}
	if serviceHasMainPID(ctx) {
		// First attempt a safe shutdown: flush the world, then ask systemd to
		// terminate the game normally. A hung process is force-killed only after
		// the bounded graceful attempt fails.
		_, _ = a.SendCommand(ctx, cfg, "saveworld")
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(2 * time.Second):
		}
		stopCtx, cancelStop := context.WithTimeout(ctx, 60*time.Second)
		stopErr := systemctl7DTD(stopCtx, "stop")
		cancelStop()
		if stopErr == nil {
			stopErr = waitFor7DTDState(ctx, false, 5*time.Second)
		}
		if stopErr != nil || serviceHasMainPID(ctx) {
			if killErr := a.Kill(ctx); killErr != nil {
				return "", fmt.Errorf("safe shutdown failed (%v); forced kill also failed: %w", stopErr, killErr)
			}
		}
	}
	if serviceHasMainPID(ctx) {
		return "", fmt.Errorf("server process is still running; refusing to wipe save")
	}
	restartNeeded := true
	defer func() {
		if restartNeeded {
			_ = systemctl7DTD(context.Background(), "start")
		}
	}()
	if targetErr == nil {
		if output, err := exec.CommandContext(ctx, "/usr/bin/sudo", "-n", "/usr/local/sbin/mastermind-wipe-7dtd-save", configPath, target).CombinedOutput(); err != nil {
			return "", fmt.Errorf("delete save: %w: %s", err, strings.TrimSpace(string(output)))
		}
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		return "", fmt.Errorf("save path still exists after delete")
	}
	if err := systemctl7DTD(ctx, "start"); err != nil {
		return "", fmt.Errorf("save deleted but server restart failed: %w", err)
	}
	if err := waitFor7DTDState(ctx, true, 60*time.Second); err != nil {
		return "", fmt.Errorf("server service did not become active: %w", err)
	}
	freshSaveMarker := filepath.Join(target, "main.ttw")
	deadline := time.Now().Add(3 * time.Minute)
	for {
		if _, err := os.Stat(freshSaveMarker); err == nil {
			break
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf("server started but fresh save was not created within 3 minutes")
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	restartNeeded = false
	return target, nil
}

func systemctl7DTD(ctx context.Context, action string) error {
	return systemctlService(ctx, action, "7dtd.service")
}

// Kill immediately terminates every process in the 7DTD systemd unit. This is
// intentionally not graceful and must only be exposed behind a destructive UI.
func (a *Adapter) Kill(ctx context.Context) error {
	if !serviceHasMainPID(ctx) {
		// Emergency stop controls should be idempotent. A repeated click after a
		// successful kill still satisfies the requested final state.
		return nil
	}
	output, err := exec.CommandContext(ctx, "/usr/bin/sudo", "-n", "/usr/bin/systemctl", "kill", "--kill-who=main", "--signal=SIGKILL", "7dtd.service").CombinedOutput()
	if err != nil {
		return fmt.Errorf("kill 7DTD process: %w: %s", err, strings.TrimSpace(string(output)))
	}
	// A service configured with Restart=on-failure will otherwise immediately
	// respawn after SIGKILL. Stop the now-dead unit to suppress that restart.
	if err := systemctl7DTD(ctx, "stop"); err != nil {
		return fmt.Errorf("prevent 7DTD restart after kill: %w", err)
	}
	output, err = exec.CommandContext(ctx, "/usr/bin/sudo", "-n", "/usr/bin/systemctl", "reset-failed", "7dtd.service").CombinedOutput()
	if err != nil {
		return fmt.Errorf("clear killed 7DTD service state: %w: %s", err, strings.TrimSpace(string(output)))
	}
	if err := waitFor7DTDState(ctx, false, 15*time.Second); err != nil {
		return fmt.Errorf("7DTD process remained active after kill: %w", err)
	}
	return nil
}

func serviceHasMainPID(ctx context.Context) bool {
	output, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "show", "--property=MainPID", "--value", "7dtd.service").Output()
	if err != nil {
		return false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(output)))
	return err == nil && pid > 0
}

func systemctlService(ctx context.Context, action, service string) error {
	if action != "start" && action != "stop" {
		return fmt.Errorf("unsupported systemctl action")
	}
	if service != "7dtd.service" && service != "regionhealer.service" {
		return fmt.Errorf("unsupported systemctl service")
	}
	output, err := exec.CommandContext(ctx, "/usr/bin/sudo", "-n", "/usr/bin/systemctl", action, service).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s: %w: %s", action, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func waitFor7DTDState(ctx context.Context, active bool, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		err := exec.CommandContext(ctx, "/usr/bin/systemctl", "is-active", "--quiet", "7dtd.service").Run()
		if (err == nil) == active {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for active=%t", active)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

func (a *Adapter) Start(ctx context.Context, cfg *agent.InstanceConfig) error {
	if err := applyStagedPlayerProfiles(cfg.ServerInstanceID); err != nil {
		return fmt.Errorf("apply staged player profiles before start: %w", err)
	}
	if cfg.StartCommand != "" {
		parts := strings.Fields(cfg.StartCommand)
		if len(parts) == 0 {
			return fmt.Errorf("empty start_command")
		}
		return a.Runner.run(ctx, cfg.InstallPath, parts[0], parts[1:]...)
	}
	// Default: run start.sh in install path if present
	startPath := filepath.Join(cfg.InstallPath, "start.sh")
	if _, err := os.Stat(startPath); err == nil {
		return a.Runner.run(ctx, cfg.InstallPath, "/bin/sh", startPath)
	}
	return fmt.Errorf("no start_command and no start.sh in install_path %q", cfg.InstallPath)
}

func (a *Adapter) SaveWorld(ctx context.Context, cfg *agent.InstanceConfig) (agent.JobResult, error) {
	if !serviceActive(ctx, "7dtd.service") {
		return agent.JobResult{Status: "failed", Error: "server is not running"}, nil
	}
	out, err := a.SendCommand(ctx, cfg, "saveworld")
	if err != nil {
		return agent.JobResult{Status: "failed", Error: err.Error()}, nil
	}
	if consoleRejected(out) {
		return agent.JobResult{Status: "failed", Error: "7DTD rejected saveworld", Output: out}, nil
	}
	return agent.JobResult{Status: "success", Output: out, Result: map[string]interface{}{"command": "saveworld"}}, nil
}

// SaveStop flushes the world, copies a manual full-world backup, then stops 7DTD.
func (a *Adapter) SaveStop(ctx context.Context, cfg *agent.InstanceConfig, payload map[string]interface{}) (agent.JobResult, error) {
	if !serviceActive(ctx, "7dtd.service") {
		return agent.JobResult{Status: "failed", Error: "server is not running"}, nil
	}
	backup, err := a.BackupSave(ctx, cfg, getString(payload, "server_config_path", ""), getInt(payload, "retention_count", 10))
	if err != nil {
		return agent.JobResult{Status: "failed", Error: fmt.Sprintf("save-stop backup: %v", err)}, nil
	}
	if err := a.Stop(ctx, cfg); err != nil {
		return agent.JobResult{Status: "failed", Error: fmt.Sprintf("world saved and backup %s created, but shutdown failed: %v", backup.ID, err), Result: map[string]interface{}{"backup": backup}}, nil
	}
	if err := waitFor7DTDState(ctx, false, 2*time.Minute); err != nil {
		return agent.JobResult{Status: "failed", Error: fmt.Sprintf("world saved and backup %s created, but server did not stop: %v", backup.ID, err), Result: map[string]interface{}{"backup": backup}}, nil
	}
	return agent.JobResult{
		Status: "success",
		Output: fmt.Sprintf("Saved world, created backup %s, and stopped the server", backup.ID),
		Result: map[string]interface{}{"backup": backup, "stopped": true},
	}, nil
}

func (a *Adapter) SetMaintenance(ctx context.Context, cfg *agent.InstanceConfig, payload map[string]interface{}) (agent.JobResult, error) {
	if payload == nil {
		payload = map[string]interface{}{}
	}
	enabled := getBool(payload, "enabled")
	password := getString(payload, "password", "")
	if err := applyMaintenancePassword(cfg, enabled, password); err != nil {
		return agent.JobResult{Status: "failed", Error: err.Error()}, nil
	}
	if serviceActive(ctx, "7dtd.service") {
		if enabled {
			payload["kick_reason"] = getString(payload, "kick_reason", "Server entering maintenance")
		} else if getString(payload, "kick_reason", "") == "" {
			payload["kick_reason"] = "Server leaving maintenance"
		}
		result, err := a.SafeRestart(ctx, cfg, payload)
		if err != nil {
			return result, err
		}
		if result.Result == nil {
			result.Result = map[string]interface{}{}
		}
		result.Result["maintenance"] = enabled
		if result.Output == "" {
			result.Output = fmt.Sprintf("Maintenance %s; server restarted", map[bool]string{true: "enabled", false: "disabled"}[enabled])
		}
		return result, nil
	}
	if err := a.Start(ctx, cfg); err != nil {
		return agent.JobResult{Status: "failed", Error: fmt.Sprintf("password updated but server did not start: %v", err)}, nil
	}
	return agent.JobResult{Status: "success", Output: fmt.Sprintf("Maintenance %s; server started", map[bool]string{true: "enabled", false: "disabled"}[enabled]), Result: map[string]interface{}{"maintenance": enabled, "started": true}}, nil
}

func (a *Adapter) Stop(ctx context.Context, cfg *agent.InstanceConfig) error {
	if cfg.StopCommand != "" {
		parts := strings.Fields(cfg.StopCommand)
		if len(parts) == 0 {
			return fmt.Errorf("empty stop_command")
		}
		return a.Runner.run(ctx, cfg.InstallPath, parts[0], parts[1:]...)
	}
	// Same-host deployments are supervised by systemd, but first use 7DTD's
	// supported shutdown command. It asks the game to save and exit cleanly.
	// If Telnet is unavailable or the game does not stop within the service
	// window, systemd sends the configured SIGINT as the safe fallback.
	if isSystemdManaged7DTD(cfg) {
		return a.stopSystemdManaged7DTD(ctx, cfg)
	}
	// `shutdown`, rather than `quit`, is the dedicated-server command that
	// saves and exits. `quit` only ends a console/session in many builds.
	resp, err := a.SendCommand(ctx, cfg, "shutdown")
	if err == nil && !consoleRejected(resp) {
		return nil
	}
	// Fallback: kill script or pkill (platform-dependent)
	stopPath := filepath.Join(cfg.InstallPath, "stop.sh")
	if _, err := os.Stat(stopPath); err == nil {
		return a.Runner.run(ctx, cfg.InstallPath, "/bin/sh", stopPath)
	}
	return fmt.Errorf("no stop_command, telnet shutdown failed, and no stop.sh")
}

func (a *Adapter) stopSystemdManaged7DTD(ctx context.Context, cfg *agent.InstanceConfig) error {
	if !serviceActive(ctx, "7dtd.service") {
		return nil
	}
	output, telnetErr := a.SendCommand(ctx, cfg, "shutdown")
	if telnetErr == nil && !consoleRejected(output) {
		if err := waitFor7DTDState(ctx, false, 2*time.Minute); err == nil {
			return nil
		}
	}
	if err := systemctl7DTD(ctx, "stop"); err != nil {
		if telnetErr != nil {
			return fmt.Errorf("7DTD Telnet shutdown failed (%v); systemd fallback failed: %w", telnetErr, err)
		}
		return fmt.Errorf("7DTD did not stop after Telnet shutdown; systemd fallback failed: %w", err)
	}
	return nil
}

func isSystemdManaged7DTD(cfg *agent.InstanceConfig) bool {
	parts := strings.Fields(cfg.StartCommand)
	return len(parts) >= 4 && parts[len(parts)-3] == "/usr/bin/systemctl" && parts[len(parts)-2] == "start" && parts[len(parts)-1] == "7dtd.service"
}

func (a *Adapter) Restart(ctx context.Context, cfg *agent.InstanceConfig) error {
	if cfg.AvoidBloodMoonRestart {
		if err := a.waitUntilRestartDay(ctx, cfg); err != nil {
			return err
		}
	}
	if err := a.Stop(ctx, cfg); err != nil {
		return err
	}
	// A successful telnet "quit" response only confirms command receipt. 7DTD
	// can spend considerably longer than three seconds flushing its save and
	// stopping. Starting systemd while the old unit is still active is a no-op,
	// which previously made restart jobs report success without a restart.
	if err := waitFor7DTDState(ctx, false, 2*time.Minute); err != nil {
		return fmt.Errorf("server did not stop before restart: %w", err)
	}
	if err := a.Start(ctx, cfg); err != nil {
		return err
	}
	if err := waitFor7DTDState(ctx, true, 30*time.Second); err != nil {
		return fmt.Errorf("server did not become active after restart: %w", err)
	}
	return nil
}

// SafeRestart warns connected players, takes a full save backup, removes all
// players, and only then performs the normal verified service restart.
func (a *Adapter) SafeRestart(ctx context.Context, cfg *agent.InstanceConfig, payload map[string]interface{}) (agent.JobResult, error) {
	deferredForBloodMoon := false
	if cfg.AvoidBloodMoonRestart {
		var err error
		deferredForBloodMoon, err = a.waitUntilRestartDayWithNotice(ctx, cfg, true)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
	}

	// A restart deferred during Blood Moon already sent its sole player-facing
	// notice. Once the next day starts, proceed immediately without replaying a
	// countdown that falsely implies another 60-second delay.
	if !deferredForBloodMoon {
		warnings := []string{
			"Server will be rebooting in 1 minute",
			"Server will be rebooting in 50 seconds",
			"Server will be rebooting in 40 seconds",
			"Server will be rebooting in 30 seconds",
			"Server will be rebooting in 20 seconds",
			"Server will be rebooting in 10 seconds",
		}
		if getBool(payload, "enabled") {
			warnings = []string{
				"Server entering maintenance. Reboot in 1 minute",
				"Server entering maintenance. Reboot in 50 seconds",
				"Server entering maintenance. Reboot in 40 seconds",
				"Server entering maintenance. Reboot in 30 seconds",
				"Server entering maintenance. Reboot in 20 seconds",
				"Server entering maintenance. Reboot in 10 seconds",
			}
		}
		for _, warning := range warnings {
			if _, err := a.SendCommand(ctx, cfg, fmt.Sprintf("say %q", warning)); err != nil {
				return agent.JobResult{Status: "failed", Error: fmt.Sprintf("send restart warning: %v", err)}, nil
			}
			select {
			case <-ctx.Done():
				return agent.JobResult{Status: "failed", Error: ctx.Err().Error()}, nil
			case <-time.After(10 * time.Second):
			}
		}
	}

	backup, err := a.BackupSave(ctx, cfg, getString(payload, "server_config_path", ""), getInt(payload, "retention_count", 10))
	if err != nil {
		return agent.JobResult{Status: "failed", Error: fmt.Sprintf("safe restart backup: %v", err)}, nil
	}

	kickReason := getString(payload, "kick_reason", "Server is Restarting")
	if kickReason == "" {
		kickReason = "Server is Restarting"
	}
	kickOutput, err := a.SendCommand(ctx, cfg, fmt.Sprintf("kickall %q", kickReason))
	if err != nil {
		return agent.JobResult{Status: "failed", Error: fmt.Sprintf("safe restart kickall: %v", err)}, nil
	}
	if consoleRejected(kickOutput) {
		return agent.JobResult{Status: "failed", Error: "7DTD rejected safe restart kickall command", Output: kickOutput}, nil
	}
	select {
	case <-ctx.Done():
		return agent.JobResult{Status: "failed", Error: ctx.Err().Error()}, nil
	case <-time.After(2 * time.Second):
	}
	verification, err := a.SendCommand(ctx, cfg, "lp")
	if err != nil {
		return agent.JobResult{Status: "failed", Error: fmt.Sprintf("safe restart kick verification: %v", err), Output: kickOutput}, nil
	}
	remaining, err := playerCountFromList(verification)
	if err != nil || remaining != 0 {
		if err != nil {
			return agent.JobResult{Status: "failed", Error: fmt.Sprintf("safe restart kick verification: %v", err), Output: kickOutput + "\n" + verification}, nil
		}
		return agent.JobResult{Status: "failed", Error: fmt.Sprintf("safe restart found %d player(s) still online", remaining), Output: kickOutput + "\n" + verification}, nil
	}

	// Blood Moon protection was evaluated before the countdown; avoid checking
	// it again after players have already been removed.
	restartCfg := *cfg
	restartCfg.AvoidBloodMoonRestart = false
	if err := a.Restart(ctx, &restartCfg); err != nil {
		return agent.JobResult{Status: "failed", Error: fmt.Sprintf("safe restart: %v", err), Output: kickOutput}, nil
	}
	return agent.JobResult{
		Status: "success",
		Output: kickOutput + "\nVerification: 0 players online",
		Result: map[string]interface{}{"backup": backup, "playersRemaining": 0, "restarted": true},
	}, nil
}

var gameDayPattern = regexp.MustCompile(`(?i)\bday\s+(\d+)\b`)

func (a *Adapter) waitUntilRestartDay(ctx context.Context, cfg *agent.InstanceConfig) error {
	_, err := a.waitUntilRestartDayWithNotice(ctx, cfg, false)
	return err
}

func (a *Adapter) waitUntilRestartDayWithNotice(ctx context.Context, cfg *agent.InstanceConfig, notifyPlayers bool) (bool, error) {
	queued := false
	for {
		output, err := a.SendCommand(ctx, cfg, "gettime")
		if err != nil {
			return queued, fmt.Errorf("check game day before restart: %w", err)
		}
		match := gameDayPattern.FindStringSubmatch(output)
		if len(match) != 2 {
			return queued, fmt.Errorf("check game day before restart: could not parse gettime response")
		}
		day, err := strconv.Atoi(match[1])
		if err != nil {
			return queued, fmt.Errorf("check game day before restart: %w", err)
		}
		if day <= 0 || day%7 != 0 {
			if queued {
				agent.ReportProgress(ctx, "running", fmt.Sprintf("Day %d started; beginning safe restart", day))
			}
			return queued, nil
		}
		if !queued {
			queued = true
			if notifyPlayers {
				if _, err := a.SendCommand(ctx, cfg, `say "The server will be restarting after bloodmoon"`); err != nil {
					return queued, fmt.Errorf("send Blood Moon restart notice: %w", err)
				}
			}
			agent.ReportProgress(ctx, "queued", fmt.Sprintf("Blood Moon protection: waiting for Day %d (currently Day %d)", day+1, day))
		} else {
			agent.ReportProgress(ctx, "queued", fmt.Sprintf("Blood Moon protection: still waiting for Day %d (currently Day %d)", day+1, day))
		}
		select {
		case <-ctx.Done():
			return queued, ctx.Err()
		case <-time.After(30 * time.Second):
		}
	}
}

func (a *Adapter) Status(ctx context.Context, cfg *agent.InstanceConfig) (string, error) {
	// Try telnet "status" or "version" to see if server responds
	out, err := a.SendCommand(ctx, cfg, "version")
	if err == nil && len(out) > 0 {
		return "running", nil
	}
	// Heuristic: check if log file is being written (optional)
	logPath, _ := a.GetLogPath(cfg)
	if logPath != "" {
		if fi, err := os.Stat(logPath); err == nil && fi.Size() > 0 {
			return "running", nil
		}
	}
	return "stopped", nil
}

func (a *Adapter) SendCommand(ctx context.Context, cfg *agent.InstanceConfig, command string) (string, error) {
	return sendTelnet(ctx, cfg.TelnetHost, cfg.TelnetPort, cfg.TelnetPassword, command)
}

func (a *Adapter) StreamChat(ctx context.Context, cfg *agent.InstanceConfig, w io.Writer) error {
	logPath, err := a.GetLogPath(cfg)
	if err != nil || logPath == "" {
		return agent.ErrUnsupported
	}
	// Tail log file and stream lines that look like chat (simplified: stream all)
	return tailFile(ctx, logPath, w)
}

// sanitizeRCONArg removes metacharacters that could inject additional RCON/telnet commands.
func sanitizeRCONArg(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r != ';' && r != '\n' && r != '\r' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func playerCommandIdentifier(payload map[string]interface{}) string {
	identifier := sanitizeRCONArg(getString(payload, "identifier", ""))
	platform := getString(payload, "platform", "")
	if identifier == "" || strings.Contains(identifier, "_") {
		return identifier
	}
	if isAllDigits(identifier) {
		return identifier
	}
	if strings.EqualFold(platform, "Steam") {
		return "Steam_" + identifier
	}
	if strings.EqualFold(platform, "EOS") {
		return "EOS_" + identifier
	}
	return identifier
}

func setDeathsIdentifiers(payload map[string]interface{}) []string {
	seen := map[string]bool{}
	ids := make([]string, 0, 4)
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || strings.ContainsAny(value, " \t\"'`") || seen[value] {
			return
		}
		seen[value] = true
		ids = append(ids, value)
	}
	primary := playerCommandIdentifier(payload)
	add(primary)
	steam := sanitizeRCONArg(payloadString(payload, "steamId"))
	if steam != "" && !strings.Contains(steam, "_") {
		add("Steam_" + steam)
	} else {
		add(steam)
	}
	eos := sanitizeRCONArg(payloadString(payload, "eosId"))
	if eos != "" && !strings.HasPrefix(strings.ToUpper(eos), "EOS_") {
		add("EOS_" + eos)
	} else {
		add(eos)
	}
	add(sanitizeRCONArg(payloadString(payload, "entityId")))
	add(sanitizeRCONArg(payloadString(payload, "name")))
	return ids
}

func setDeathsCommand(identifier string, deaths int) (string, error) {
	return setDeathsCommandNamed("st-SetPlayerDeaths", identifier, deaths)
}

func setDeathsCommandNamed(command, identifier string, deaths int) (string, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return "", fmt.Errorf("player identifier required")
	}
	if strings.ContainsAny(identifier, " \t\"'`") {
		return "", fmt.Errorf("player identifier must not contain spaces or quotes")
	}
	if deaths < 0 || deaths > 100000 {
		return "", fmt.Errorf("deaths must be a whole number from 0 to 100000")
	}
	return fmt.Sprintf("%s %s %d", command, identifier, deaths), nil
}

func payloadString(payload map[string]interface{}, key string) string {
	switch value := payload[key].(type) {
	case string:
		return value
	case float64:
		if value == float64(int(value)) {
			return strconv.Itoa(int(value))
		}
	case int:
		return strconv.Itoa(value)
	case json.Number:
		return value.String()
	}
	return ""
}

func isAllDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func (a *Adapter) setPlayerDeaths(ctx context.Context, cfg *agent.InstanceConfig, payload map[string]interface{}, deaths int) (string, string, error) {
	ids := setDeathsIdentifiers(payload)
	if len(ids) == 0 {
		return "", "", fmt.Errorf("player identifier required")
	}
	commands := []string{"st-SetPlayerDeaths", "st-SetDeaths"}
	var lastOut, lastCmd string
	unknown := false
	for _, name := range commands {
		unknown = false
		for _, id := range ids {
			cmd, err := setDeathsCommandNamed(name, id, deaths)
			if err != nil {
				return "", "", err
			}
			out, err := a.SendCommand(ctx, cfg, cmd)
			lastOut, lastCmd = out, cmd
			if err != nil {
				return out, cmd, err
			}
			lower := strings.ToLower(out)
			if strings.Contains(lower, "unknown command") || strings.Contains(lower, "no command or topic found") || strings.Contains(lower, "is not a valid command") {
				unknown = true
				break
			}
			if strings.Contains(lower, "not found") || strings.Contains(lower, "unable to find") || strings.Contains(lower, "does not exist") || strings.Contains(lower, "usage:") {
				continue
			}
			if consoleRejected(out) {
				return out, cmd, fmt.Errorf("Could not set deaths. The player must be online, and ServerTools st-SetPlayerDeaths must be installed")
			}
			return out, cmd, nil
		}
		if !unknown {
			break
		}
	}
	if lastOut == "" {
		return lastOut, lastCmd, fmt.Errorf("Could not set deaths. The player must be online, and ServerTools st-SetPlayerDeaths must be installed")
	}
	return lastOut, lastCmd, fmt.Errorf("Could not set deaths. The player must be online, and ServerTools st-SetPlayerDeaths must be installed")
}

func consoleRejected(output string) bool {
	lower := strings.ToLower(output)
	return strings.Contains(lower, " is not a valid ") ||
		strings.Contains(lower, "error executing command") ||
		strings.Contains(lower, "unknown command") ||
		strings.Contains(lower, "no command or topic found")
}

var playerCountPattern = regexp.MustCompile(`(?i)total of\s+(\d+)\s+in the game`)

func playerCountFromList(output string) (int, error) {
	match := playerCountPattern.FindStringSubmatch(output)
	if len(match) != 2 {
		return 0, fmt.Errorf("could not parse lp response")
	}
	return strconv.Atoi(match[1])
}

func (a *Adapter) KickPlayer(ctx context.Context, cfg *agent.InstanceConfig, playerID string) error {
	_, err := a.SendCommand(ctx, cfg, "kick "+sanitizeRCONArg(playerID))
	return err
}

func (a *Adapter) BanPlayer(ctx context.Context, cfg *agent.InstanceConfig, playerID string, reason string) error {
	cmd := "ban add " + sanitizeRCONArg(playerID)
	if reason != "" {
		cmd += " " + sanitizeRCONArg(reason)
	}
	_, err := a.SendCommand(ctx, cfg, cmd)
	return err
}

func (a *Adapter) InstallMod(ctx context.Context, cfg *agent.InstanceConfig, modID string, opts map[string]interface{}) error {
	// 7DTD mod install is typically file-based or workshop; not a single telnet command.
	return agent.ErrUnsupported
}

func (a *Adapter) GetLogPath(cfg *agent.InstanceConfig) (string, error) {
	if cfg.InstallPath == "" {
		return "", fmt.Errorf("install_path required")
	}
	// 7DTD dedicated server log path
	p := filepath.Join(cfg.InstallPath, "7DaysToDieServer_Data", "output_log.txt")
	return p, nil
}

// latestPlayerLogInventory returns the newest ServerTools Player_Logs section
// for the entity requested by st-pil. Player_Logs includes stack quantities;
// st-pil itself only prints item names and slots.
func latestPlayerLogInventory(installPath, command string) (string, bool) {
	match := regexp.MustCompile(`(?i)^st-pil\s+(\d+)\s*$`).FindStringSubmatch(strings.TrimSpace(command))
	if len(match) != 2 {
		return "", false
	}
	entityID := match[1]
	roots := []string{}
	if filepath.IsAbs(installPath) {
		roots = append(roots, filepath.Clean(installPath))
	}
	if len(roots) == 0 || roots[0] != "/opt/7dtd/server" {
		roots = append(roots, "/opt/7dtd/server")
	}
	files := []string{}
	for _, root := range roots {
		found, err := filepath.Glob(filepath.Join(root, "Mods", "ServerTools_Config", "Logs", "PlayerLogs", "PlayerLog_*.xml"))
		if err == nil {
			files = append(files, found...)
		}
	}
	if len(files) == 0 {
		return "", false
	}
	sort.Slice(files, func(i, j int) bool {
		li, ei := os.Stat(files[i])
		lj, ej := os.Stat(files[j])
		if ei != nil || ej != nil {
			return files[i] > files[j]
		}
		return li.ModTime().After(lj.ModTime())
	})
	data, err := os.ReadFile(files[0])
	if err != nil || len(data) == 0 || len(data) > 64*1024*1024 {
		return "", false
	}
	text := string(data)
	sectionRE := regexp.MustCompile(`(?s)<Player\b[^>]*>.*?(?=<Player\b|</Player>)`)
	blocks := sectionRE.FindAllString(text, -1)
	for i := len(blocks) - 1; i >= 0; i-- {
		block := blocks[i]
		if !regexp.MustCompile(`(?m)^\s*EntityId\s+` + regexp.QuoteMeta(entityID) + `\s+/`).MatchString(block) {
			continue
		}
		timestamps := regexp.MustCompile(`(?m)^\s*\d{2}:\d{2}:\d{2}:\s*'`).FindAllStringIndex(block, -1)
		if len(timestamps) == 0 {
			return block, true
		}
		return block[timestamps[len(timestamps)-1][0]:], true
	}
	return "", false
}

// sendTelnet connects to 7DTD Telnet, sends an optional password and one command,
// then explicitly exits the console session. The final `exit` prevents 7DTD from
// trying to write a fresh prompt into a client socket that has already vanished.
func sendTelnet(ctx context.Context, host string, port int, password, command string) (string, error) {
	addr := fmt.Sprintf("%s:%d", host, port)
	dialer := &net.Dialer{}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	stopContextWatch := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Now()) })
	defer stopContextWatch()
	command = strings.TrimSpace(command)
	if command == "" {
		return "", fmt.Errorf("Telnet command is required")
	}
	isPlayerList := strings.EqualFold(command, "lp")
	firstResponseTimeout := 15 * time.Second
	if isPlayerList {
		firstResponseTimeout = 25 * time.Second
	}

	// 7DTD sends a greeting immediately. A few builds do not, so an idle read
	// is acceptable; a non-timeout network error is not.
	if _, err := readTelnetChunk(ctx, conn, 3*time.Second); err != nil {
		return "", fmt.Errorf("read Telnet greeting: %w", err)
	}
	if password != "" {
		if _, err := conn.Write([]byte(password + "\n")); err != nil {
			return "", err
		}
		if _, err := readTelnetChunk(ctx, conn, 3*time.Second); err != nil {
			return "", fmt.Errorf("authenticate Telnet session: %w", err)
		}
	}
	if _, err := conn.Write([]byte(command + "\n")); err != nil {
		return "", err
	}

	out, err := readTelnetResponse(ctx, conn, firstResponseTimeout, isPlayerList)
	if err != nil {
		return strings.TrimSpace(string(out)), err
	}
	// shutdown deliberately terminates the server, and exit already closes a
	// console session. Do not append a second command in either case.
	if !strings.EqualFold(command, "shutdown") && !strings.EqualFold(command, "exit") {
		closeTelnetSession(ctx, conn)
	}
	return strings.TrimSpace(string(out)), nil
}

func readTelnetChunk(ctx context.Context, conn net.Conn, timeout time.Duration) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < timeout {
		timeout = time.Until(deadline)
	}
	if timeout <= 0 {
		return nil, context.DeadlineExceeded
	}
	if err := conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		return nil, err
	}
	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if ctxErr := ctx.Err(); ctxErr != nil {
		return nil, ctxErr
	}
	if ne, ok := err.(net.Error); ok && ne.Timeout() {
		return nil, nil
	}
	if err != nil && n == 0 {
		if err == io.EOF {
			return nil, nil
		}
		return nil, err
	}
	return buf[:n], nil
}

func readTelnetResponse(ctx context.Context, conn net.Conn, firstResponseTimeout time.Duration, isPlayerList bool) ([]byte, error) {
	var out []byte
	chunk, err := readTelnetChunk(ctx, conn, firstResponseTimeout)
	if err != nil {
		return out, err
	}
	out = append(out, chunk...)
	if len(out) == 0 {
		return out, nil
	}
	if isPlayerList && strings.Contains(string(out), "Total of ") {
		return out, nil
	}
	idleTimeout := 750 * time.Millisecond
	if isPlayerList {
		idleTimeout = 2 * time.Second
	}
	for {
		chunk, err = readTelnetChunk(ctx, conn, idleTimeout)
		if err != nil {
			return out, err
		}
		if len(chunk) == 0 {
			return out, nil
		}
		out = append(out, chunk...)
		if isPlayerList && strings.Contains(string(out), "Total of ") {
			return out, nil
		}
	}
}

func closeTelnetSession(ctx context.Context, conn net.Conn) {
	if ctx.Err() != nil {
		return
	}
	if _, err := conn.Write([]byte("exit\n")); err != nil {
		return
	}
	// 7DTD normally closes immediately after exit. Ignore the result: the
	// preceding command already completed and a session cleanup failure should
	// not turn it into a failed administrative action.
	_, _ = readTelnetChunk(ctx, conn, time.Second)
}

// tailFile reads the file and writes new content to w, respecting ctx (simplified: one-shot read for placeholder).
func tailFile(ctx context.Context, path string, w io.Writer) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(w, f)
	return err
}
