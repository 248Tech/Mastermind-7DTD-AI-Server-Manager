package sevendtd

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

func TestApplyStagedPlayerProfilesIsOneShotAndUpdatesBak(t *testing.T) {
	staging := t.TempDir()
	backups := t.TempDir()
	playerDir := filepath.Join(t.TempDir(), "Player")
	if err := os.MkdirAll(playerDir, 0755); err != nil {
		t.Fatal(err)
	}

	original := []byte("ttp\x00original-profile")
	edited := []byte("ttp\x00edited-once-profile")
	live := filepath.Join(playerDir, "EOS_test.ttp")
	if err := os.WriteFile(live, original, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(live+".bak", original, 0644); err != nil {
		t.Fatal(err)
	}

	previousStaging := profileStagingRoot
	previousBackup := profileBackupRoot
	previousRunning := sevenDaysRunning
	t.Cleanup(func() {
		profileStagingRoot = previousStaging
		profileBackupRoot = previousBackup
		sevenDaysRunning = previousRunning
	})
	profileStagingRoot = staging
	profileBackupRoot = backups
	sevenDaysRunning = func() bool { return false }

	serverID := "server1"
	relative := "World/Save/Player/EOS_test.ttp"
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(relative)))
	stageDir := filepath.Join(staging, serverID)
	if err := os.MkdirAll(stageDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, key+".ttp"), edited, 0644); err != nil {
		t.Fatal(err)
	}
	metadata, err := json.Marshal(stagedProfileMetadata{Target: live, Relative: relative, StagedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, key+".json"), metadata, 0644); err != nil {
		t.Fatal(err)
	}

	if err := applyStagedPlayerProfiles(serverID); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(live)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(edited) {
		t.Fatalf("live profile = %q, want edited snapshot", got)
	}
	gotBak, err := os.ReadFile(live + ".bak")
	if err != nil {
		t.Fatal(err)
	}
	if string(gotBak) != string(edited) {
		t.Fatalf("bak companion = %q, want edited snapshot", gotBak)
	}
	entries, err := os.ReadDir(stageDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("staging queue was not consumed: %v", names(entries))
	}

	progressed := []byte("ttp\x00player-progressed")
	if err := os.WriteFile(live, progressed, 0644); err != nil {
		t.Fatal(err)
	}
	if err := applyStagedPlayerProfiles(serverID); err != nil {
		t.Fatal(err)
	}
	got, err = os.ReadFile(live)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(progressed) {
		t.Fatalf("stale snapshot was re-applied: %q", got)
	}
}

func TestApplyStagedPlayerProfilesRefusesWhileServerRunning(t *testing.T) {
	staging := t.TempDir()
	playerDir := filepath.Join(t.TempDir(), "Player")
	if err := os.MkdirAll(playerDir, 0755); err != nil {
		t.Fatal(err)
	}
	live := filepath.Join(playerDir, "EOS_test.ttp")
	original := []byte("ttp\x00original")
	if err := os.WriteFile(live, original, 0644); err != nil {
		t.Fatal(err)
	}

	previousStaging := profileStagingRoot
	previousRunning := sevenDaysRunning
	t.Cleanup(func() {
		profileStagingRoot = previousStaging
		sevenDaysRunning = previousRunning
	})
	profileStagingRoot = staging
	sevenDaysRunning = func() bool { return true }

	serverID := "server1"
	relative := "World/Save/Player/EOS_test.ttp"
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(relative)))
	stageDir := filepath.Join(staging, serverID)
	if err := os.MkdirAll(stageDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, key+".ttp"), []byte("ttp\x00edited"), 0644); err != nil {
		t.Fatal(err)
	}
	metadata, err := json.Marshal(stagedProfileMetadata{Target: live, Relative: relative, StagedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, key+".json"), metadata, 0644); err != nil {
		t.Fatal(err)
	}

	if err := applyStagedPlayerProfiles(serverID); err == nil {
		t.Fatal("expected error while 7DTD is running")
	}
	got, err := os.ReadFile(live)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(original) {
		t.Fatalf("live profile changed while server running: %q", got)
	}
}

func TestStagePlayerProfileDeleteOnlyTargetsActiveSave(t *testing.T) {
	staging := t.TempDir()
	userData := t.TempDir()
	saves := filepath.Join(userData, "Saves")
	activePlayerDir := filepath.Join(saves, "Navezgane", "ActiveSave", "Player")
	historicalPlayerDir := filepath.Join(saves, "OldWorld", "OldSave", "Player")
	for _, dir := range []string{activePlayerDir, historicalPlayerDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	active := filepath.Join(activePlayerDir, "EOS_player-1.ttp")
	historical := filepath.Join(historicalPlayerDir, "EOS_player-1.ttp")
	if err := os.WriteFile(active, []byte("ttp\x00active"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(active+".bak", []byte("ttp\x00active-bak"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(historical, []byte("ttp\x00historical"), 0644); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(t.TempDir(), "serverconfig.xml")
	config := `<ServerSettings><property name="GameWorld" value="Navezgane"/><property name="GameName" value="ActiveSave"/><property name="UserDataFolder" value="` + userData + `"/></ServerSettings>`
	if err := os.WriteFile(configPath, []byte(config), 0644); err != nil {
		t.Fatal(err)
	}

	previousStaging := profileStagingRoot
	previousRunning := sevenDaysRunning
	t.Cleanup(func() {
		profileStagingRoot = previousStaging
		sevenDaysRunning = previousRunning
	})
	profileStagingRoot = staging
	sevenDaysRunning = func() bool { return false }
	payload := map[string]interface{}{
		"server_instance_id": "server1",
		"config": map[string]interface{}{"discovery": map[string]interface{}{"savesPath": saves, "serverConfigPath": configPath}},
	}
	profiles, err := stagePlayerProfileDelete(&agent.InstanceConfig{}, payload, "", "player-1")
	if err != nil || len(profiles) != 1 || profiles[0].Path != "Navezgane/ActiveSave/Player/EOS_player-1.ttp" {
		t.Fatalf("profiles=%+v err=%v", profiles, err)
	}
	listed, err := listPlayerProfiles(payload)
	if err != nil || len(listed) != 2 {
		t.Fatalf("list profiles=%+v err=%v", listed, err)
	}
	for _, profile := range listed {
		if profile.Path == profiles[0].Path && profile.InjectionStatus != "reset_queued" {
			t.Fatalf("reset status=%q", profile.InjectionStatus)
		}
	}
	if err := applyStagedPlayerProfiles("server1"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(active); !os.IsNotExist(err) {
		t.Fatalf("active profile still exists: %v", err)
	}
	if _, err := os.Stat(active + ".bak"); !os.IsNotExist(err) {
		t.Fatalf("active profile companion still exists: %v", err)
	}
	if _, err := os.Stat(historical); err != nil {
		t.Fatalf("historical profile was changed: %v", err)
	}
}

func names(entries []os.DirEntry) []string {
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry.Name())
	}
	return out
}
