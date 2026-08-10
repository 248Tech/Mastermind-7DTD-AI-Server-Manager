package sevendtd

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
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
	case "SERVER_RESTART":
		return resultOrErr(a.Restart(ctx, cfg))
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
	default:
		return agent.JobResult{Status: "failed", Error: "unsupported job type: " + job.Type}, nil
	}
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
	return nil
}

type modInfo struct {
	Folder  string `json:"folder"`
	Name    string `json:"name"`
	Author  string `json:"author,omitempty"`
	Website string `json:"website,omitempty"`
	Version string `json:"version,omitempty"`
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
	return listModsAt(root)
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
		mods = append(mods, info)
	}
	sort.Slice(mods, func(i, j int) bool { return strings.ToLower(mods[i].Name) < strings.ToLower(mods[j].Name) })
	return mods, nil
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
		ServerInstanceID: getString(p, "server_instance_id", ""),
		InstallPath:      getString(p, "install_path", ""),
		StartCommand:     getString(p, "start_command", ""),
		StopCommand:      getString(p, "stop_command", ""),
		TelnetHost:       getString(p, "telnet_host", "127.0.0.1"),
		TelnetPort:       getInt(p, "telnet_port", 8081),
		TelnetPassword:   getString(p, "telnet_password", ""),
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
	if err := pruneFullSaveBackups(retention); err != nil {
		return SaveRecord{}, fmt.Errorf("backup created but retention cleanup failed: %w", err)
	}
	return SaveRecord{ID: id, CreatedAt: created, GameDay: gameDay, Kind: metadata.Kind, SizeBytes: directorySize(destination)}, nil
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
	_ = os.RemoveAll(old)
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
	_ = os.RemoveAll(old)
	return selected, nil
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
	if err := systemctl7DTD(ctx, "stop"); err != nil {
		return "", fmt.Errorf("stop server before wipe: %w", err)
	}
	if err := waitFor7DTDState(ctx, false, 60*time.Second); err != nil {
		return "", fmt.Errorf("server did not stop before wipe: %w", err)
	}
	restartNeeded := true
	defer func() {
		if restartNeeded {
			_ = systemctl7DTD(context.Background(), "start")
		}
	}()
	if targetErr == nil {
		if output, err := exec.CommandContext(ctx, "/usr/bin/sudo", "/usr/local/sbin/mastermind-wipe-7dtd-save", configPath, target).CombinedOutput(); err != nil {
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

func systemctlService(ctx context.Context, action, service string) error {
	if action != "start" && action != "stop" {
		return fmt.Errorf("unsupported systemctl action")
	}
	if service != "7dtd.service" && service != "regionhealer.service" {
		return fmt.Errorf("unsupported systemctl service")
	}
	output, err := exec.CommandContext(ctx, "/usr/bin/sudo", "/usr/bin/systemctl", action, service).CombinedOutput()
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

var gameDayPattern = regexp.MustCompile(`(?i)\bday\s+(\d+)\b`)

func (a *Adapter) waitUntilRestartDay(ctx context.Context, cfg *agent.InstanceConfig) error {
	for {
		output, err := a.SendCommand(ctx, cfg, "gettime")
		if err != nil {
			return fmt.Errorf("check game day before restart: %w", err)
		}
		match := gameDayPattern.FindStringSubmatch(output)
		if len(match) != 2 {
			return fmt.Errorf("check game day before restart: could not parse gettime response")
		}
		day, err := strconv.Atoi(match[1])
		if err != nil {
			return fmt.Errorf("check game day before restart: %w", err)
		}
		if day <= 0 || day%7 != 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
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
	return strings.Contains(lower, " is not a valid ") || strings.Contains(lower, "error executing command")
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
