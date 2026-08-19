package sevendtd

import (
	"archive/zip"
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
		)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"folders": folders, "count": len(folders), "quarantined": true}}, nil
	case "MOD_QUARANTINE":
		folder := getString(job.Payload, "folder", "")
		if err := quarantineMod(cfg, getString(job.Payload, "mods_path", ""), folder); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"quarantined": folder}}, nil
	case "MOD_QUARANTINE_LIST":
		root, err := quarantinePath(cfg, getString(job.Payload, "mods_path", ""))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		mods, err := listModsAt(root)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"mods": mods}}, nil
	case "MOD_RESTORE":
		folder := getString(job.Payload, "folder", "")
		if err := restoreMod(cfg, getString(job.Payload, "mods_path", ""), folder); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"restored": folder}}, nil
	case "MOD_DELETE":
		folder := getString(job.Payload, "folder", "")
		if err := deleteModWithPipe(ctx, cfg, getString(job.Payload, "mods_path", ""), folder); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"deleted": folder}}, nil
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
	default:
		return agent.JobResult{Status: "failed", Error: "unsupported job type: " + job.Type}, nil
	}
}

// Keep the base64 job result below Nest's default JSON request limit.
// Normal 7DTD profiles are only tens of KiB.
const maxProfileEditorBytes = 64 * 1024
const profileStagingRoot = "/var/lib/mastermind-agent/profile-staging"
const profileBackupRoot = "/var/lib/mastermind-agent/profile-backups"

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
			states[path] = profileInjectionState{Status: "queued", StagedAt: metadata.StagedAt}
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
	if hasQueued && exec.Command("/usr/bin/systemctl", "is-active", "--quiet", "7dtd.service").Run() == nil {
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
		info, err := os.Lstat(metadata.Target)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("live profile is no longer a regular file: %s", metadata.Relative)
		}
		dataPath := strings.TrimSuffix(metadataPath, ".json") + ".ttp"
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
	return nil
}

const maxModArchiveFiles = 10000
const maxModArchiveExpandedBytes int64 = 2 * 1024 * 1024 * 1024

func installUploadedModsToQuarantine(cfg *agent.InstanceConfig, override, archivePath, originalName string) ([]string, error) {
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

	quarantineRoot, err := quarantinePath(cfg, override)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(quarantineRoot, 0750); err != nil {
		return nil, fmt.Errorf("create quarantine directory: %w", err)
	}
	stagingRoot, err := os.MkdirTemp(quarantineRoot, ".upload-*")
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
		if _, err := os.Lstat(filepath.Join(quarantineRoot, folder)); !os.IsNotExist(err) {
			return nil, fmt.Errorf("quarantined mod already exists: %s", folder)
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
		destination := filepath.Join(quarantineRoot, folder)
		if err := os.Rename(stagedMod, destination); err != nil {
			for _, rollback := range moved {
				_ = os.RemoveAll(filepath.Join(quarantineRoot, rollback))
			}
			return nil, fmt.Errorf("place %s in quarantine: %w", folder, err)
		}
		moved = append(moved, folder)
		folders = append(folders, folder)
	}
	sort.Strings(folders)
	return folders, nil
}

func quarantinePath(cfg *agent.InstanceConfig, override string) (string, error) {
	root, err := modsPath(cfg, override)
	if err != nil {
		return "", err
	}
	serverKey := cfg.ServerInstanceID
	if serverKey == "" {
		serverKey = filepath.Base(filepath.Dir(root))
	}
	return filepath.Join("/var/lib/mastermind-agent/mod-quarantine", serverKey), nil
}

func restoreMod(cfg *agent.InstanceConfig, override, folder string) error {
	root, err := modsPath(cfg, override)
	if err != nil {
		return err
	}
	quarantineRoot, err := quarantinePath(cfg, override)
	if err != nil {
		return err
	}
	source, err := realModDirectory(quarantineRoot, folder)
	if err != nil {
		return fmt.Errorf("quarantined %w", err)
	}
	destination := filepath.Join(root, folder)
	if _, err := os.Lstat(destination); !os.IsNotExist(err) {
		return fmt.Errorf("active mod folder already exists: %s", folder)
	}
	if output, err := exec.Command("/usr/bin/mv", "--", source, destination).CombinedOutput(); err != nil {
		return fmt.Errorf("restore mod: %w: %s", err, strings.TrimSpace(string(output)))
	}
	if err := normalizeModPermissions(destination); err != nil {
		return fmt.Errorf("make restored mod readable by game server: %w", err)
	}
	now := time.Now()
	if err := os.Chtimes(destination, now, now); err != nil {
		return fmt.Errorf("record restored mod activation time: %w", err)
	}
	return nil
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
			return os.Chmod(path, 0750)
		}
		return os.Chmod(path, 0640)
	})
}

type modInfo struct {
	Folder      string    `json:"folder"`
	Name        string    `json:"name"`
	Author      string    `json:"author,omitempty"`
	Website     string    `json:"website,omitempty"`
	Version     string    `json:"version,omitempty"`
	ActivatedAt time.Time `json:"activatedAt"`
	PendingRestart bool `json:"pendingRestart,omitempty"`
	ConfigFiles []string  `json:"configFiles,omitempty"`
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
		mods[index].PendingRestart = modPendingRestart(cfg, mods[index].ActivatedAt)
	}
	return mods, nil
}

// modPendingRestart marks a folder restored after the current game service
// start. The files are active on disk but 7DTD will not load them until its
// next restart, so the UI must distinguish this limbo state from loaded mods.
func modPendingRestart(cfg *agent.InstanceConfig, activatedAt time.Time) bool {
	if activatedAt.IsZero() || cfg == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := exec.CommandContext(ctx, "/usr/bin/systemctl", "is-active", "--quiet", "7dtd.service").Run(); err != nil {
		return false
	}
	out, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "show", "-p", "ExecMainStartTimestamp", "--value", "7dtd.service").Output()
	if err != nil {
		return false
	}
	started, err := parseSystemdTimestamp(strings.TrimSpace(string(out)))
	return err == nil && activatedAt.After(started.Add(-2*time.Second))
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
		if !entry.IsDir() {
			continue
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
		info.ConfigFiles = findModConfigFiles(filepath.Join(root, entry.Name()))
		mods = append(mods, info)
	}
	sort.Slice(mods, func(i, j int) bool { return strings.ToLower(mods[i].Name) < strings.ToLower(mods[j].Name) })
	return mods, nil
}

const maxModConfigBytes = 64 * 1024

var editableModConfigExtensions = map[string]bool{
	".cfg": true, ".conf": true, ".ini": true, ".json": true,
	".toml": true, ".txt": true, ".xml": true, ".yaml": true, ".yml": true,
}

func findModConfigFiles(modRoot string) []string {
	files := make([]string, 0)
	_ = filepath.Walk(modRoot, func(path string, info os.FileInfo, err error) error {
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
			if path != modRoot && strings.HasPrefix(info.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		rel, relErr := filepath.Rel(modRoot, path)
		if relErr != nil || !isEditableModConfig(rel) || info.Size() > maxModConfigBytes {
			return nil
		}
		files = append(files, filepath.ToSlash(rel))
		if len(files) >= 100 {
			return filepath.SkipAll
		}
		return nil
	})
	sort.Strings(files)
	return files
}

func isEditableModConfig(relativePath string) bool {
	clean := filepath.Clean(relativePath)
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return false
	}
	if !editableModConfigExtensions[strings.ToLower(filepath.Ext(clean))] {
		return false
	}
	parts := strings.Split(filepath.ToSlash(clean), "/")
	if len(parts) > 1 && strings.EqualFold(parts[0], "Config") {
		return true
	}
	base := strings.ToLower(filepath.Base(clean))
	return strings.Contains(base, "config") || strings.Contains(base, "settings")
}

func resolveModConfig(root, folder, relativePath string) (string, error) {
	modRoot, err := realModDirectory(root, folder)
	if err != nil {
		return "", err
	}
	clean := filepath.Clean(strings.TrimSpace(relativePath))
	if !isEditableModConfig(clean) {
		return "", fmt.Errorf("invalid or unsupported mod config path")
	}
	target := filepath.Join(modRoot, clean)
	info, err := os.Lstat(target)
	if err != nil {
		return "", fmt.Errorf("mod config not found: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("mod config must be a regular file")
	}
	if info.Size() > maxModConfigBytes {
		return "", fmt.Errorf("mod config exceeds 64 KiB editor limit")
	}
	return target, nil
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

func writeModConfig(cfg *agent.InstanceConfig, override, folder, relativePath, content string) error {
	if len(content) > maxModConfigBytes {
		return fmt.Errorf("mod config exceeds 64 KiB editor limit")
	}
	root, err := modsPath(cfg, override)
	if err != nil {
		return err
	}
	target, err := resolveModConfig(root, folder, relativePath)
	if err != nil {
		return err
	}
	info, err := os.Stat(target)
	if err != nil {
		return fmt.Errorf("stat mod config: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".mastermind-config-*")
	if err != nil {
		return fmt.Errorf("create temporary mod config: %w", err)
	}
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
	if err = os.Chmod(temporaryPath, info.Mode().Perm()); err != nil {
		return fmt.Errorf("preserve mod config permissions: %w", err)
	}
	if err = os.Rename(temporaryPath, target); err != nil {
		return fmt.Errorf("replace mod config: %w", err)
	}
	return nil
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

func (a *Adapter) Stop(ctx context.Context, cfg *agent.InstanceConfig) error {
	if cfg.StopCommand != "" {
		parts := strings.Fields(cfg.StopCommand)
		if len(parts) == 0 {
			return fmt.Errorf("empty stop_command")
		}
		return a.Runner.run(ctx, cfg.InstallPath, parts[0], parts[1:]...)
	}
	// Same-host deployments registered with the hardened systemd start command
	// must stop through the matching unit. Telnet can acknowledge a connection
	// without ever executing quit, leaving restart jobs waiting on the old PID.
	if isSystemdManaged7DTD(cfg) {
		return systemctl7DTD(ctx, "stop")
	}
	// Try to send "quit" via telnet for graceful shutdown
	resp, err := a.SendCommand(ctx, cfg, "quit")
	if err == nil && resp != "" {
		return nil
	}
	// Fallback: kill script or pkill (platform-dependent)
	stopPath := filepath.Join(cfg.InstallPath, "stop.sh")
	if _, err := os.Stat(stopPath); err == nil {
		return a.Runner.run(ctx, cfg.InstallPath, "/bin/sh", stopPath)
	}
	return fmt.Errorf("no stop_command, telnet quit failed, and no stop.sh")
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

	kickOutput, err := a.SendCommand(ctx, cfg, `kickall "Server is Restarting"`)
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
	if strings.EqualFold(platform, "Steam") {
		return "Steam_" + identifier
	}
	if strings.EqualFold(platform, "EOS") {
		return "EOS_" + identifier
	}
	return identifier
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
	if filepath.IsAbs(installPath) { roots = append(roots, filepath.Clean(installPath)) }
	if len(roots) == 0 || roots[0] != "/opt/7dtd/server" { roots = append(roots, "/opt/7dtd/server") }
	files := []string{}
	for _, root := range roots {
		found, err := filepath.Glob(filepath.Join(root, "Mods", "ServerTools_Config", "Logs", "PlayerLogs", "PlayerLog_*.xml"))
		if err == nil { files = append(files, found...) }
	}
	if len(files) == 0 {
		return "", false
	}
	sort.Slice(files, func(i, j int) bool {
		li, ei := os.Stat(files[i]); lj, ej := os.Stat(files[j])
		if ei != nil || ej != nil { return files[i] > files[j] }
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
		if !regexp.MustCompile(`(?m)^\s*EntityId\s+` + regexp.QuoteMeta(entityID) + `\s+/`).MatchString(block) { continue }
		timestamps := regexp.MustCompile(`(?m)^\s*\d{2}:\d{2}:\d{2}:\s*'`).FindAllStringIndex(block, -1)
		if len(timestamps) == 0 { return block, true }
		return block[timestamps[len(timestamps)-1][0]:], true
	}
	return "", false
}

// sendTelnet connects to 7DTD telnet, sends password, then command; returns response.
func sendTelnet(ctx context.Context, host string, port int, password, command string) (string, error) {
	addr := fmt.Sprintf("%s:%d", host, port)
	dialer := &net.Dialer{}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	isPlayerList := strings.EqualFold(strings.TrimSpace(command), "lp")
	deadline := 15 * time.Second
	if isPlayerList {
		deadline = 25 * time.Second
	}
	conn.SetDeadline(time.Now().Add(deadline))
	// 7DTD: server may send "password:" or similar; send password then command
	buf := make([]byte, 4096)
	n, _ := conn.Read(buf)
	_ = n
	if password != "" {
		if _, err := conn.Write([]byte(password + "\n")); err != nil {
			return "", err
		}
		time.Sleep(200 * time.Millisecond)
		n, _ = conn.Read(buf)
		_ = n
	}
	if _, err := conn.Write([]byte(command + "\n")); err != nil {
		return "", err
	}
	time.Sleep(500 * time.Millisecond)
	var out []byte
	for {
		readTimeout := 2 * time.Second
		if isPlayerList {
			readTimeout = 20 * time.Second
		}
		conn.SetReadDeadline(time.Now().Add(readTimeout))
		n, err := conn.Read(buf)
		if n > 0 {
			out = append(out, buf[:n]...)
			if isPlayerList && strings.Contains(string(out), "Total of ") {
				break
			}
		}
		if err != nil || n == 0 {
			break
		}
	}
	return strings.TrimSpace(string(out)), nil
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
