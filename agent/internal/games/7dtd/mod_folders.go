package sevendtd

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var modFolderSanitizer = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func deriveModFolderFromArchiveName(originalName string) string {
	folder := strings.TrimSuffix(filepath.Base(strings.TrimSpace(originalName)), filepath.Ext(originalName))
	folder = modFolderSanitizer.ReplaceAllString(folder, "_")
	folder = strings.Trim(folder, "._-")
	if len(folder) > 100 {
		folder = folder[:100]
	}
	return folder
}

func listModFolderNames(root string) map[string]bool {
	names := map[string]bool{}
	entries, err := os.ReadDir(root)
	if err != nil {
		return names
	}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		names[strings.ToLower(entry.Name())] = true
	}
	return names
}

func activeModFolderExists(root, folder string) bool {
	if folder == "" {
		return false
	}
	names := listModFolderNames(root)
	return names[strings.ToLower(folder)]
}

func nextAvailableModFolder(root, base string) (string, error) {
	if err := validateModFolder(base); err != nil {
		return "", err
	}
	if !activeModFolderExists(root, base) {
		return base, nil
	}
	for i := 1; i <= 999; i++ {
		candidate := fmt.Sprintf("%s (%d)", base, i)
		if err := validateModFolder(candidate); err != nil {
			continue
		}
		if !activeModFolderExists(root, candidate) {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("too many active mods named like %q", base)
}

func removeActiveModFolder(root, folder string) error {
	target, err := realModDirectory(root, folder)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := os.RemoveAll(target); err != nil {
		return fmt.Errorf("remove active mod %s: %w", folder, err)
	}
	return nil
}
