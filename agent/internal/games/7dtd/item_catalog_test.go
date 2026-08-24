package sevendtd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/mastermind/agent/internal/agent"
)

func TestExtractItemNames(t *testing.T) {
	names := map[string]struct{}{}
	extractItemNames(`
		<item name="resourceWood">
		<item name='gunHandgunT1Pistol'>
		<block name="keystoneBlock">
		<item name="all">
		<item name="../secret">
		<item name="bad name">
		<item name="modFoo:Bar">
	`, names)
	if _, ok := names["resourceWood"]; !ok {
		t.Fatal("expected resourceWood")
	}
	if _, ok := names["gunHandgunT1Pistol"]; !ok {
		t.Fatal("expected quoted pistol")
	}
	if _, ok := names["keystoneBlock"]; !ok {
		t.Fatal("expected block names such as keystoneBlock")
	}
	if _, ok := names["modFoo:Bar"]; !ok {
		t.Fatal("expected colon names used by some mods")
	}
	if _, ok := names["all"]; ok {
		t.Fatal("rejected giveplus all")
	}
	if _, ok := names["../secret"]; ok {
		t.Fatal("rejected path-like names")
	}
	if _, ok := names["bad name"]; ok {
		t.Fatal("rejected names with spaces")
	}
}

func TestListItemCatalogReadsVanillaAndMods(t *testing.T) {
	root := t.TempDir()
	vanillaDir := filepath.Join(root, "Data", "Config")
	iconDir := filepath.Join(root, "Data", "ItemIcons")
	modDir := filepath.Join(root, "Mods", "CoolMod", "Config")
	for _, dir := range []string{vanillaDir, iconDir, modDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(vanillaDir, "items.xml"), []byte(`<items><item name="resourceWood"></item></items>`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(vanillaDir, "blocks.xml"), []byte(`<blocks><block name="keystoneBlock"></block></blocks>`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modDir, "items.xml"), []byte(`<items><item name="modCoolThing"></item></items>`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modDir, "blocks.xml"), []byte(`<blocks><block name="modCoolBlock"></block></blocks>`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(iconDir, "iconOnlyThing.png"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := listItemCatalog(&agent.InstanceConfig{InstallPath: root})
	if err != nil {
		t.Fatal(err)
	}
	gz, _ := result["catalogGz"].(string)
	if gz == "" {
		t.Fatal("expected compressed catalog")
	}
	if result["count"] != 5 {
		t.Fatalf("count=%v want 5", result["count"])
	}
	if result["files"].(int) < 4 {
		t.Fatalf("files=%v", result["files"])
	}
}
