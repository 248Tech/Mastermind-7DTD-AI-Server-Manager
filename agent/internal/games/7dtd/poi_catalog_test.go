package sevendtd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/mastermind/agent/internal/agent"
)

func TestPOICatalogAndPreview(t *testing.T) {
	root := t.TempDir()
	poi := filepath.Join(root, "Data", "Prefabs", "POIs")
	if err := os.MkdirAll(poi, 0o755); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(poi, "house_01.xml"), []byte("<prefab/>"), 0o644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(poi, "house_01.jpg"), []byte("jpeg"), 0o644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(poi, "no_preview.xml"), []byte("<prefab/>"), 0o644); err != nil { t.Fatal(err) }
	cfg := &agent.InstanceConfig{InstallPath: root}
	catalog, err := listPOICatalog(cfg)
	if err != nil { t.Fatal(err) }
	if catalog["count"] != 2 { t.Fatalf("count=%v", catalog["count"]) }
	preview, err := readPOIPreview(cfg, "house_01")
	if err != nil || preview["available"] != true { t.Fatalf("preview=%v err=%v", preview, err) }
	if _, err := readPOIPreview(cfg, "../secret"); err == nil { t.Fatal("accepted traversal name") }
}
