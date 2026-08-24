package sevendtd

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/mastermind/agent/internal/agent"
)

const (
	maxItemCatalogFiles     = 800
	maxItemCatalogFileBytes = 40 * 1024 * 1024
	maxItemCatalogNames     = 25_000
	maxItemCatalogPayload   = 180_000
)

var (
	// Vanilla and mod configs define giftable names as both <item> and <block>
	// (e.g. keystoneBlock lives only in blocks.xml).
	itemNameAttr = regexp.MustCompile(`(?i)<(?:item|block)\b[^>]*?\bname\s*=\s*(?:"([^"]+)"|'([^']+)')`)
	grantItemRE  = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_:]{0,79}$`)
	catalogXMLRE = regexp.MustCompile(`(?i)^(items|blocks)\.xml$`)
)

func listItemCatalog(cfg *agent.InstanceConfig) (map[string]interface{}, error) {
	if cfg == nil || strings.TrimSpace(cfg.InstallPath) == "" {
		return nil, fmt.Errorf("install_path required")
	}
	root := filepath.Clean(cfg.InstallPath)
	names := map[string]struct{}{}
	files := 0

	for _, relative := range []string{
		filepath.Join("Data", "Config", "items.xml"),
		filepath.Join("Data", "Config", "blocks.xml"),
	} {
		ok, err := collectItemNamesFromFile(filepath.Join(root, relative), names)
		if err != nil {
			return nil, err
		}
		if ok {
			files++
		}
	}

	modsRoot := filepath.Join(root, "Mods")
	modFiles, err := findModCatalogXML(modsRoot)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	for _, path := range modFiles {
		if files >= maxItemCatalogFiles {
			break
		}
		ok, err := collectItemNamesFromFile(path, names)
		if err != nil {
			return nil, err
		}
		if ok {
			files++
		}
	}

	_, iconFiles := collectItemNamesFromIcons(filepath.Join(root, "Data", "ItemIcons"), names)
	files += iconFiles

	list := make([]string, 0, len(names))
	for name := range names {
		list = append(list, name)
	}
	sort.Strings(list)
	truncated := false
	if len(list) > maxItemCatalogNames {
		list = list[:maxItemCatalogNames]
		truncated = true
	}
	catalogGz, err := compressItemNames(list)
	if err != nil {
		return nil, err
	}
	for len(catalogGz) > maxItemCatalogPayload && len(list) > 100 {
		list = list[:len(list)*4/5]
		truncated = true
		catalogGz, err = compressItemNames(list)
		if err != nil {
			return nil, err
		}
	}
	return map[string]interface{}{
		"catalogGz": catalogGz,
		"count":     len(list),
		"files":     files,
		"truncated": truncated,
	}, nil
}

func findModCatalogXML(modsRoot string) ([]string, error) {
	info, err := os.Stat(modsRoot)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, nil
	}
	var files []string
	err = filepath.WalkDir(modsRoot, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			name := strings.ToLower(d.Name())
			if name == ".git" || name == "node_modules" || strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if len(files) >= maxItemCatalogFiles {
			return io.EOF
		}
		if !catalogXMLRE.MatchString(d.Name()) {
			return nil
		}
		files = append(files, path)
		return nil
	})
	if err == io.EOF {
		err = nil
	}
	return files, err
}

func collectItemNamesFromFile(path string, names map[string]struct{}) (bool, error) {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	if info.IsDir() || info.Size() <= 0 || info.Size() > maxItemCatalogFileBytes {
		return false, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	extractItemNames(string(raw), names)
	return true, nil
}

func collectItemNamesFromIcons(iconRoot string, names map[string]struct{}) (added int, files int) {
	entries, err := os.ReadDir(iconRoot)
	if err != nil {
		return 0, 0
	}
	files = 1
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".png") {
			continue
		}
		base := strings.TrimSuffix(name, filepath.Ext(name))
		if sanitized := sanitizeGrantItemName(base); sanitized != "" {
			if _, exists := names[sanitized]; exists {
				continue
			}
			if len(names) >= maxItemCatalogNames {
				return added, files
			}
			names[sanitized] = struct{}{}
			added++
		}
	}
	return added, files
}

func extractItemNames(xmlText string, names map[string]struct{}) {
	matches := itemNameAttr.FindAllStringSubmatch(xmlText, -1)
	for _, match := range matches {
		name := match[1]
		if name == "" {
			name = match[2]
		}
		if sanitized := sanitizeGrantItemName(name); sanitized != "" {
			if len(names) >= maxItemCatalogNames {
				return
			}
			names[sanitized] = struct{}{}
		}
	}
}

func sanitizeGrantItemName(raw string) string {
	name := strings.TrimSpace(raw)
	if name == "" || strings.EqualFold(name, "all") {
		return ""
	}
	if !grantItemRE.MatchString(name) {
		return ""
	}
	return name
}

func compressItemNames(names []string) (string, error) {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := io.WriteString(zw, strings.Join(names, "\n")); err != nil {
		_ = zw.Close()
		return "", err
	}
	if err := zw.Close(); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}
