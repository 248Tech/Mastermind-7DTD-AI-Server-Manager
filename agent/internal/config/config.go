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
}

type HeartbeatCfg struct {
	IntervalSec int `yaml:"interval_sec" json:"interval_sec"` // 5–10
}

type JobsCfg struct {
	PollIntervalSec int  `yaml:"poll_interval_sec" json:"poll_interval_sec"`
	LongPollSec     int  `yaml:"long_poll_sec" json:"long_poll_sec"` // 0 = short poll
	WebSocket       bool `yaml:"websocket" json:"websocket"`       // future
}

type HostCfg struct {
	Name string `yaml:"name" json:"name"` // optional; CP may override
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
