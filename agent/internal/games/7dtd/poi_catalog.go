package sevendtd

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/mastermind/agent/internal/agent"
)

const (
	maxPOICatalogFiles   = 5_000
	maxPOICatalogPayload = 180_000
	maxPOIPreviewBytes   = 96 * 1024
)

// POI prefab names are file names, not player supplied paths. Keep the
// accepted alphabet deliberately narrow before using a name on disk.
func validPOIName(name string) bool {
	if len(name) == 0 || len(name) > 160 || strings.Contains(name, "..") {
		return false
	}
	for _, r := range name {
		if !(r >= 'a' && r <= 'z') && !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && r != '_' && r != '-' && r != '.' {
			return false
		}
	}
	return true
}

func listPOICatalog(cfg *agent.InstanceConfig) (map[string]interface{}, error) {
	if cfg == nil || strings.TrimSpace(cfg.InstallPath) == "" {
		return nil, fmt.Errorf("install_path required")
	}
	root := filepath.Join(filepath.Clean(cfg.InstallPath), "Data", "Prefabs", "POIs")
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	items := make([]string, 0, len(entries))
	for _, entry := range entries {
		if len(items) >= maxPOICatalogFiles {
			break
		}
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".xml") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if !validPOIName(name) {
			continue
		}
		_, previewErr := os.Stat(filepath.Join(root, name+".jpg"))
		hasPreview := previewErr == nil
		preview := "0"
		if hasPreview {
			preview = "1"
		}
		items = append(items, name+"\t"+preview)
	}
	sort.Strings(items)
	encoded, err := compressPOICatalog(items)
	if err != nil {
		return nil, err
	}
	truncated := false
	for len(encoded) > maxPOICatalogPayload && len(items) > 10 {
		items = items[:len(items)*4/5]
		truncated = true
		encoded, err = compressPOICatalog(items)
		if err != nil {
			return nil, err
		}
	}
	return map[string]interface{}{"catalogGz": encoded, "count": len(items), "truncated": truncated}, nil
}

func compressPOICatalog(items []string) (string, error) {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := io.WriteString(zw, strings.Join(items, "\n")); err != nil {
		_ = zw.Close()
		return "", err
	}
	if err := zw.Close(); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

func readPOIPreview(cfg *agent.InstanceConfig, name string) (map[string]interface{}, error) {
	if cfg == nil || strings.TrimSpace(cfg.InstallPath) == "" {
		return nil, fmt.Errorf("install_path required")
	}
	name = strings.TrimSpace(name)
	if !validPOIName(name) {
		return nil, fmt.Errorf("invalid POI name")
	}
	path := filepath.Join(filepath.Clean(cfg.InstallPath), "Data", "Prefabs", "POIs", name+".jpg")
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return map[string]interface{}{"name": name, "available": false}, nil
	}
	if err != nil {
		return nil, err
	}
	if info.IsDir() || info.Size() <= 0 || info.Size() > maxPOIPreviewBytes {
		return nil, fmt.Errorf("POI preview is unavailable or too large")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"name": name, "available": true, "mimeType": "image/jpeg", "imageBase64": base64.StdEncoding.EncodeToString(data)}, nil
}
