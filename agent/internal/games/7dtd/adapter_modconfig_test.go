package sevendtd

import (
	"os"
	"path/filepath"
	"testing"
)

func TestModConfigFileWritable(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "ServerToolsConfig.xml")
	if err := os.WriteFile(target, []byte("before"), 0644); err != nil {
		t.Fatal(err)
	}
	if !modConfigFileWritable(target) {
		t.Fatal("expected owner-writable file to be writable for test user")
	}
	if err := os.Chmod(target, 0444); err != nil {
		t.Fatal(err)
	}
	if modConfigFileWritable(target) && os.Geteuid() != 0 {
		t.Fatal("expected read-only file to be non-writable")
	}
	if err := os.Chmod(target, 0664); err != nil {
		t.Fatal(err)
	}
	if !modConfigFileWritable(target) {
		t.Fatal("expected group-writable file to be writable")
	}
}

func TestFindModConfigFilesIncludesSiblingConfigFolder(t *testing.T) {
	root := t.TempDir()
	mod := filepath.Join(root, "ServerTools")
	sibling := filepath.Join(root, "ServerTools_Config")
	if err := os.MkdirAll(filepath.Join(sibling, "Logs"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(mod, 0755); err != nil {
		t.Fatal(err)
	}
	mustWrite := func(path, body string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite(filepath.Join(mod, "ModInfo.xml"), "<xml/>")
	mustWrite(filepath.Join(mod, "ServerToolsConfig.xml"), "<xml/>")
	mustWrite(filepath.Join(sibling, "CommandList.xml"), "<xml/>")
	mustWrite(filepath.Join(sibling, "Phrases.xml"), "<xml/>")
	mustWrite(filepath.Join(sibling, "HowToSetup.txt"), "docs")
	mustWrite(filepath.Join(sibling, "ServerTools.bin"), "binary")
	mustWrite(filepath.Join(sibling, "Logs", "ignored.xml"), "<xml/>")

	files := findModConfigFiles(root, "ServerTools")
	got := stringsJoin(files)
	if !contains(files, "ServerToolsConfig.xml") {
		t.Fatalf("missing in-mod config: %s", got)
	}
	if !contains(files, "../ServerTools_Config/CommandList.xml") {
		t.Fatalf("missing sibling CommandList.xml: %s", got)
	}
	if !contains(files, "../ServerTools_Config/Phrases.xml") {
		t.Fatalf("missing sibling Phrases.xml: %s", got)
	}
	if !contains(files, "../ServerTools_Config/HowToSetup.txt") {
		t.Fatalf("missing sibling HowToSetup.txt: %s", got)
	}
	if contains(files, "../ServerTools_Config/Logs/ignored.xml") || contains(files, "../ServerTools_Config/ServerTools.bin") {
		t.Fatalf("included skipped files: %s", got)
	}
}

func TestListModsAtSkipsRuntimeConfigFolder(t *testing.T) {
	root := t.TempDir()
	mod := filepath.Join(root, "ServerTools")
	sibling := filepath.Join(root, "ServerTools_Config")
	if err := os.MkdirAll(mod, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(sibling, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mod, "ModInfo.xml"), []byte(`<xml><Name value="Server Tools"/></xml>`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sibling, "CommandList.xml"), []byte("<xml/>"), 0644); err != nil {
		t.Fatal(err)
	}
	mods, err := listModsAt(root)
	if err != nil {
		t.Fatal(err)
	}
	var serverTools *modInfo
	for index := range mods {
		if mods[index].Folder == "ServerTools" {
			serverTools = &mods[index]
		}
	}
	if serverTools == nil {
		t.Fatalf("mods=%v", mods)
	}
	if !contains(serverTools.ConfigFiles, "../ServerTools_Config/CommandList.xml") {
		t.Fatalf("ServerTools config files=%v", serverTools.ConfigFiles)
	}
}

func TestIsEditableModConfigSiblingPaths(t *testing.T) {
	if !isEditableModConfig("ServerTools", "../ServerTools_Config/CommandList.xml") {
		t.Fatal("expected sibling xml to be editable")
	}
	if isEditableModConfig("ServerTools", "../OtherMod/secret.xml") {
		t.Fatal("rejected other-mod escape")
	}
	if isEditableModConfig("ServerTools", "../ServerTools_Config/../secret.xml") {
		t.Fatal("rejected cleaned sibling escape")
	}
	if isEditableModConfig("ServerTools", "CommandList.xml") {
		t.Fatal("files inside the dll folder still require config/settings in the name")
	}
}

func TestResolveModConfigSibling(t *testing.T) {
	root := t.TempDir()
	mod := filepath.Join(root, "ServerTools")
	sibling := filepath.Join(root, "ServerTools_Config")
	if err := os.MkdirAll(mod, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(sibling, 0755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(sibling, "CommandList.xml")
	if err := os.WriteFile(target, []byte("<xml/>"), 0644); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveModConfig(root, "ServerTools", "../ServerTools_Config/CommandList.xml")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if filepath.Clean(resolved) != filepath.Clean(target) {
		t.Fatalf("got %q want %q", resolved, target)
	}
	if _, err := resolveModConfig(root, "ServerTools", "../Other/secret.xml"); err == nil {
		t.Fatal("expected escape to fail")
	}
}

func stringsJoin(values []string) string {
	out := ""
	for i, value := range values {
		if i > 0 {
			out += ", "
		}
		out += value
	}
	return out
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestWriteModConfigFile(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "config.xml")
	if err := os.WriteFile(target, []byte("before"), 0660); err != nil {
		t.Fatal(err)
	}
	if err := writeModConfigFile(target, "after", 0660); err != nil {
		t.Fatalf("writeModConfigFile: %v", err)
	}
	content, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "after" {
		t.Fatalf("got %q", string(content))
	}
}
