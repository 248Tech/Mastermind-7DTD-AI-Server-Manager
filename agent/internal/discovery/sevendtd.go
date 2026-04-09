package discovery

import (
	"encoding/xml"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/config"
)

type SevenDTDResult struct {
	Name           string                 `json:"name,omitempty"`
	InstallPath    string                 `json:"install_path,omitempty"`
	StartCommand   string                 `json:"start_command,omitempty"`
	TelnetHost     string                 `json:"telnet_host,omitempty"`
	TelnetPort     int                    `json:"telnet_port,omitempty"`
	TelnetPassword string                 `json:"telnet_password,omitempty"`
	Config         map[string]interface{} `json:"config,omitempty"`
}

type xmlProperty struct {
	Name  string `xml:"name,attr"`
	Value string `xml:"value,attr"`
}

type xmlProperties struct {
	Properties []xmlProperty `xml:"property"`
	Admins     []struct{}    `xml:"admin"`
}

func DiscoverSevenDTD(cfg config.SevenDTDDiscoveryCfg) (*SevenDTDResult, error) {
	serverConfigPath := firstNonEmpty(
		cfg.ServerConfigPath,
		filepath.Join(cfg.InstallPath, "serverconfig.xml"),
		filepath.Join(cfg.InstallPath, "sdtdserver.xml"),
	)
	serverConfigPath = firstExistingFile(
		serverConfigPath,
		filepath.Join(cfg.InstallPath, "serverconfig.xml"),
		filepath.Join(cfg.InstallPath, "sdtdserver.xml"),
	)
	if serverConfigPath == "" {
		return nil, errors.New("7dtd server config not found")
	}

	installPath := cfg.InstallPath
	if installPath == "" {
		installPath = filepath.Dir(serverConfigPath)
	}

	props, err := loadProperties(serverConfigPath)
	if err != nil {
		return nil, err
	}

	modsPath := firstNonEmpty(cfg.ModsPath, filepath.Join(installPath, "Mods"))
	savesPath := firstNonEmpty(
		cfg.SavesPath,
		props["SaveGameFolder"],
		filepath.Join(userHomeDir(), ".local", "share", "7DaysToDie", "Saves"),
	)
	serverAdminPath := firstNonEmpty(cfg.ServerAdminXMLPath, filepath.Join(savesPath, "serveradmin.xml"))

	mods, _ := listDirNames(modsPath)
	adminCount, _ := countAdmins(serverAdminPath)

	telnetPort, _ := strconv.Atoi(firstNonEmpty(props["TelnetPort"], "8081"))
	name := firstNonEmpty(cfg.Name, props["ServerName"], filepath.Base(installPath))

	result := &SevenDTDResult{
		Name:           name,
		InstallPath:    installPath,
		StartCommand:   cfg.StartCommand,
		TelnetHost:     "127.0.0.1",
		TelnetPort:     telnetPort,
		TelnetPassword: props["TelnetPassword"],
		Config: map[string]interface{}{
			"discovery": map[string]interface{}{
				"managedByAgent":   true,
				"source":           "agent_local_7dtd",
				"discoveredAt":     time.Now().UTC().Format(time.RFC3339),
				"serverConfigPath": serverConfigPath,
				"modsPath":         modsPath,
				"savesPath":        savesPath,
				"serverAdminPath":  serverAdminPath,
				"serverName":       props["ServerName"],
				"gameName":         props["GameName"],
				"gameWorld":        props["GameWorld"],
				"saveGameFolder":   props["SaveGameFolder"],
				"telnetEnabled":    parseBoolish(props["TelnetEnabled"]),
				"modCount":         len(mods),
				"mods":             mods,
				"adminCount":       adminCount,
			},
		},
	}

	if result.StartCommand == "" {
		result.StartCommand = firstExistingFile(
			filepath.Join(installPath, "startserver.sh"),
			filepath.Join(installPath, "start.sh"),
		)
		if result.StartCommand != "" {
			result.StartCommand = "/bin/sh " + result.StartCommand
		}
	}

	return result, nil
}

func loadProperties(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var parsed xmlProperties
	if err := xml.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	out := make(map[string]string, len(parsed.Properties))
	for _, prop := range parsed.Properties {
		if prop.Name == "" {
			continue
		}
		out[prop.Name] = strings.TrimSpace(prop.Value)
	}
	return out, nil
}

func countAdmins(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	var parsed xmlProperties
	if err := xml.Unmarshal(data, &parsed); err != nil {
		return 0, err
	}
	return len(parsed.Admins), nil
}

func listDirNames(path string) ([]string, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

func firstExistingFile(paths ...string) string {
	for _, path := range paths {
		if path == "" {
			continue
		}
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func parseBoolish(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func userHomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}
