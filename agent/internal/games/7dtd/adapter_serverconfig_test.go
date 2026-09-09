package sevendtd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/mastermind/agent/internal/agent"
)

func TestConfiguredServerConfigReadWrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "serverconfig.xml")
	if err := os.WriteFile(path, []byte("<ServerSettings><property name=\"ServerName\" value=\"Before\" /></ServerSettings>"), 0o640); err != nil {
		t.Fatal(err)
	}
	payload := map[string]interface{}{"config": map[string]interface{}{"discovery": map[string]interface{}{"serverConfigPath": path}}}
	cfg := &agent.InstanceConfig{InstallPath: filepath.Join(dir, "7DaysToDieServer.x86_64")}
	content, gotPath, err := readConfiguredServerConfig(cfg, payload)
	if err != nil || gotPath != path || content == "" {
		t.Fatalf("read content=%q path=%q err=%v", content, gotPath, err)
	}
	next := "<ServerSettings><property name=\"ServerName\" value=\"After\" /></ServerSettings>"
	if _, err := writeConfiguredServerConfig(cfg, payload, next); err != nil {
		t.Fatalf("write server config: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != next {
		t.Fatalf("got=%q err=%v", got, err)
	}
}

func TestConfiguredServerConfigRejectsWrongFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "not-server-config.xml")
	if err := os.WriteFile(path, []byte("x"), 0o640); err != nil {
		t.Fatal(err)
	}
	_, err := configuredServerConfigPath(&agent.InstanceConfig{}, map[string]interface{}{"config": map[string]interface{}{"discovery": map[string]interface{}{"serverConfigPath": path}}})
	if err == nil {
		t.Fatal("expected invalid server config path error")
	}
}
