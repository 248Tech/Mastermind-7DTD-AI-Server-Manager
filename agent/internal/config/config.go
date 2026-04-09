package config

import (
	"encoding/json"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Config is the agent configuration (YAML or JSON via file).
type Config struct {
	ControlPlaneURL string       `yaml:"control_plane_url" json:"control_plane_url"`
	PairingToken    string       `yaml:"pairing_token,omitempty" json:"pairing_token,omitempty"`
	AgentKeyPath    string       `yaml:"agent_key_path" json:"agent_key_path"` // where to store signed key after pairing
	Heartbeat       HeartbeatCfg `yaml:"heartbeat" json:"heartbeat"`
	Jobs            JobsCfg      `yaml:"jobs" json:"jobs"`
	Host            HostCfg      `yaml:"host" json:"host"`
	Discovery       DiscoveryCfg `yaml:"discovery" json:"discovery"`
}

type HeartbeatCfg struct {
	IntervalSec int `yaml:"interval_sec" json:"interval_sec"` // 5–10
}

type JobsCfg struct {
	PollIntervalSec int  `yaml:"poll_interval_sec" json:"poll_interval_sec"`
	LongPollSec     int  `yaml:"long_poll_sec" json:"long_poll_sec"` // 0 = short poll
	WebSocket       bool `yaml:"websocket" json:"websocket"`         // future
}

type HostCfg struct {
	Name string `yaml:"name" json:"name"` // optional; CP may override
}

type DiscoveryCfg struct {
	Enabled  bool                 `yaml:"enabled" json:"enabled"`
	SevenDTD SevenDTDDiscoveryCfg `yaml:"seven_dtd" json:"seven_dtd"`
}

type SevenDTDDiscoveryCfg struct {
	Enabled            bool   `yaml:"enabled" json:"enabled"`
	InstallPath        string `yaml:"install_path" json:"install_path"`
	ServerConfigPath   string `yaml:"server_config_path" json:"server_config_path"`
	ModsPath           string `yaml:"mods_path" json:"mods_path"`
	SavesPath          string `yaml:"saves_path" json:"saves_path"`
	ServerAdminXMLPath string `yaml:"server_admin_xml_path" json:"server_admin_xml_path"`
	StartCommand       string `yaml:"start_command" json:"start_command"`
	Name               string `yaml:"name" json:"name"`
}

// Load reads config from path. Supports .yaml, .yml, .json.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	c := new(Config)
	switch filepath.Ext(path) {
	case ".json":
		return c, json.Unmarshal(data, c)
	default:
		return c, yaml.Unmarshal(data, c)
	}
}

// Env overrides config fields from MASTERMIND_* environment variables.
// Call after Load() and Defaults() so env vars always win.
func (c *Config) Env() {
	if v := os.Getenv("MASTERMIND_CP_URL"); v != "" {
		c.ControlPlaneURL = v
	}
	if v := os.Getenv("MASTERMIND_PAIRING_TOKEN"); v != "" {
		c.PairingToken = v
	}
	if v := os.Getenv("MASTERMIND_HOST_NAME"); v != "" {
		c.Host.Name = v
	}
	if v := os.Getenv("MASTERMIND_KEY_PATH"); v != "" {
		c.AgentKeyPath = v
	}
	if v := os.Getenv("MASTERMIND_DISCOVERY_ENABLED"); v != "" {
		c.Discovery.Enabled = v == "1" || v == "true" || v == "TRUE"
	}
	if v := os.Getenv("MASTERMIND_7DTD_DISCOVERY_ENABLED"); v != "" {
		c.Discovery.SevenDTD.Enabled = v == "1" || v == "true" || v == "TRUE"
	}
	if v := os.Getenv("MASTERMIND_7DTD_INSTALL_PATH"); v != "" {
		c.Discovery.SevenDTD.InstallPath = v
	}
	if v := os.Getenv("MASTERMIND_7DTD_SERVER_CONFIG"); v != "" {
		c.Discovery.SevenDTD.ServerConfigPath = v
	}
	if v := os.Getenv("MASTERMIND_7DTD_MODS_PATH"); v != "" {
		c.Discovery.SevenDTD.ModsPath = v
	}
	if v := os.Getenv("MASTERMIND_7DTD_SAVES_PATH"); v != "" {
		c.Discovery.SevenDTD.SavesPath = v
	}
	if v := os.Getenv("MASTERMIND_7DTD_SERVERADMIN_XML"); v != "" {
		c.Discovery.SevenDTD.ServerAdminXMLPath = v
	}
	if v := os.Getenv("MASTERMIND_7DTD_START_COMMAND"); v != "" {
		c.Discovery.SevenDTD.StartCommand = v
	}
	if v := os.Getenv("MASTERMIND_7DTD_NAME"); v != "" {
		c.Discovery.SevenDTD.Name = v
	}
}

// Defaults applies MVP defaults (heartbeat 5s, key path).
func (c *Config) Defaults() {
	if c.Heartbeat.IntervalSec <= 0 {
		c.Heartbeat.IntervalSec = 5
	}
	if c.AgentKeyPath == "" {
		c.AgentKeyPath = "/var/lib/mastermind-agent/agent.key"
	}
	if c.Jobs.PollIntervalSec <= 0 {
		c.Jobs.PollIntervalSec = 5
	}
}
