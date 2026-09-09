package sevendtd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

type quarantineRecord struct {
	OverrideActive bool      `json:"overrideActive"`
	TransferConfig bool      `json:"transferConfig,omitempty"`
	TargetFolder   string    `json:"targetFolder,omitempty"`
	UploadedAt     time.Time `json:"uploadedAt"`
}

func quarantineRecordPath(root, folder string) string {
	return filepath.Join(root, folder, ".mastermind-quarantine.json")
}

func writeQuarantineRecord(root, folder string, record quarantineRecord) error {
	if record.UploadedAt.IsZero() {
		record.UploadedAt = time.Now().UTC()
	}
	if strings.TrimSpace(record.TargetFolder) == "" {
		record.TargetFolder = folder
	}
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(quarantineRecordPath(root, folder), data, 0640)
}

func readQuarantineRecord(root, folder string) quarantineRecord {
	data, err := os.ReadFile(quarantineRecordPath(root, folder))
	if err != nil {
		return quarantineRecord{TargetFolder: folder}
	}
	var record quarantineRecord
	if json.Unmarshal(data, &record) != nil {
		return quarantineRecord{TargetFolder: folder}
	}
	if strings.TrimSpace(record.TargetFolder) == "" {
		record.TargetFolder = folder
	}
	return record
}

func listQuarantinedMods(cfg *agent.InstanceConfig, override string) ([]modInfo, error) {
	root, err := quarantinePath(cfg, override)
	if err != nil {
		return nil, err
	}
	mods, err := listModsAt(root)
	if err != nil {
		return nil, err
	}
	activeRoot, err := modsPath(cfg, override)
	if err != nil {
		return nil, err
	}
	for index := range mods {
		record := readQuarantineRecord(root, mods[index].Folder)
		mods[index].OverrideActive = record.OverrideActive
		mods[index].TransferConfig = record.TransferConfig
		base := record.TargetFolder
		if base == "" {
			base = mods[index].Folder
		}
		if activeModFolderExists(activeRoot, base) {
			mods[index].ConflictsWithActive = true
			if record.OverrideActive {
				mods[index].RestoreTarget = base
			} else if target, err := nextAvailableModFolder(activeRoot, base); err == nil {
				mods[index].RestoreTarget = target
			}
		} else {
			mods[index].RestoreTarget = base
		}
	}
	return mods, nil
}
