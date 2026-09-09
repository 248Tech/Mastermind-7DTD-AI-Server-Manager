package sevendtd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mastermind/agent/internal/agent"
	"github.com/mastermind/agent/internal/games/7dtd/configmerge"
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

func TestLiveServerToolsMergePreview(t *testing.T) {
	if os.Getenv("MASTERMIND_LIVE_MERGE_TEST") != "1" {
		t.Skip("set MASTERMIND_LIVE_MERGE_TEST=1 to run against the game host")
	}
	active := "/opt/7dtd/server/Mods"
	quarantine := "/var/lib/mastermind-agent/mod-quarantine/cmsl7rpn100077lu0ru61eilk"
	results, err := previewConfigMergeAt(active, quarantine, "ServerTools", "ServerTools")
	if err != nil {
		t.Fatal(err)
	}
	withTemplate := 0
	carried := 0
	foundProbe := false
	for _, r := range results {
		if r.TemplateContent != "" {
			withTemplate++
		}
		if !r.Skipped {
			carried += r.Stats.Carried
		}
		if strings.Contains(r.Path, "ServerToolsConfig") && strings.Contains(r.MergedContent, "MastermindAdditiveProbe") {
			foundProbe = true
			t.Logf("%s carried=%d new=%d dropped=%d", r.Path, r.Stats.Carried, r.Stats.NewKeys, r.Stats.Dropped)
		}
	}
	t.Logf("files=%d withTemplate=%d carried=%d", len(results), withTemplate, carried)
	if withTemplate == 0 {
		t.Fatal("no template files found — quarantine ServerTools_Config needs real XMLs")
	}
	if !foundProbe {
		t.Fatal("expected MastermindAdditiveProbe in merged ServerToolsConfig")
	}
	if carried == 0 {
		t.Fatal("expected some live settings to be carried over")
	}
}

func TestResolveModConfigPathAllowMissing(t *testing.T) {
	root := t.TempDir()
	mod := filepath.Join(root, "DemoMod")
	sibling := filepath.Join(root, "DemoMod_Config")
	if err := os.MkdirAll(mod, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(sibling, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveModConfig(root, "DemoMod", "../DemoMod_Config/NewSettings.xml"); err == nil {
		t.Fatal("expected missing file to fail without allowMissing")
	}
	resolved, err := resolveModConfigPath(root, "DemoMod", "../DemoMod_Config/NewSettings.xml", true)
	if err != nil {
		t.Fatalf("allowMissing resolve: %v", err)
	}
	want := filepath.Join(sibling, "NewSettings.xml")
	if filepath.Clean(resolved) != filepath.Clean(want) {
		t.Fatalf("got %q want %q", resolved, want)
	}
}

func TestPreviewConfigMergeAdditiveCarryOver(t *testing.T) {
	root := t.TempDir()
	active := filepath.Join(root, "active")
	quarantine := filepath.Join(root, "quarantine")
	for _, dir := range []string{
		filepath.Join(active, "DemoMod"),
		filepath.Join(active, "DemoMod_Config"),
		filepath.Join(quarantine, "DemoMod"),
		filepath.Join(quarantine, "DemoMod_Config"),
	} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite := func(path, body string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite(filepath.Join(active, "DemoMod", "ModInfo.xml"), `<xml><Name value="Demo"/></xml>`)
	mustWrite(filepath.Join(quarantine, "DemoMod", "ModInfo.xml"), `<xml><Name value="Demo"/></xml>`)
	mustWrite(filepath.Join(active, "DemoMod_Config", "settings.json"), `{
  "maxPlayers": 32,
  "pvp": true,
  "legacyOnly": "keep-me-not"
}`)
	mustWrite(filepath.Join(quarantine, "DemoMod_Config", "settings.json"), `{
  "maxPlayers": 8,
  "pvp": false,
  "newSetting": "from-template"
}`)
	mustWrite(filepath.Join(quarantine, "DemoMod_Config", "brandNew.json"), `{"fresh":true}`)

	cfg := &agent.InstanceConfig{ServerInstanceID: "test-server", InstallPath: filepath.Join(root, "install")}
	_ = os.MkdirAll(cfg.InstallPath, 0755)
	// Point mods_path override + quarantine via env is hard; call helpers with absolute roots by
	// temporarily using preview against custom paths through find+merge directly.
	liveFiles := findModConfigFiles(active, "DemoMod")
	templateFiles := findModConfigFiles(quarantine, "DemoMod")
	if !contains(liveFiles, "../DemoMod_Config/settings.json") {
		t.Fatalf("live files=%v", liveFiles)
	}
	if !contains(templateFiles, "../DemoMod_Config/brandNew.json") {
		t.Fatalf("template files=%v", templateFiles)
	}

	results, err := previewConfigMergeAt(active, quarantine, "DemoMod", "DemoMod")
	if err != nil {
		t.Fatal(err)
	}
	var settings *configmerge.MergeResult
	var brandNew *configmerge.MergeResult
	for i := range results {
		switch results[i].Path {
		case "../DemoMod_Config/settings.json":
			settings = &results[i]
		case "../DemoMod_Config/brandNew.json":
			brandNew = &results[i]
		}
	}
	if settings == nil || settings.Skipped {
		t.Fatalf("settings merge missing/skipped: %+v", results)
	}
	if settings.Stats.Carried < 2 {
		t.Fatalf("expected carried live values, stats=%+v content=%s", settings.Stats, settings.MergedContent)
	}
	if !strings.Contains(settings.MergedContent, `"maxPlayers": 32`) && !strings.Contains(settings.MergedContent, `"maxPlayers":32`) {
		t.Fatalf("expected maxPlayers carried as 32: %s", settings.MergedContent)
	}
	if !strings.Contains(settings.MergedContent, "newSetting") {
		t.Fatalf("expected template newSetting: %s", settings.MergedContent)
	}
	if strings.Contains(settings.MergedContent, "legacyOnly") {
		t.Fatalf("legacyOnly should be dropped: %s", settings.MergedContent)
	}
	if settings.TemplateContent == "" {
		t.Fatal("templateContent should be exposed for replace-with-original")
	}
	if brandNew == nil || brandNew.MergedContent == "" {
		t.Fatalf("brand new template file missing: %+v", results)
	}

	// Apply merged settings + new file into active tree (create missing).
	cfgWrite := &agent.InstanceConfig{InstallPath: filepath.Join(root, "install-write")}
	mods := filepath.Join(cfgWrite.InstallPath, "Mods")
	if err := os.MkdirAll(filepath.Join(mods, "DemoMod"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mods, "DemoMod", "ModInfo.xml"), []byte(`<xml/>`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(mods, "DemoMod_Config"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mods, "DemoMod_Config", "settings.json"), []byte(`{"maxPlayers":1}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := writeModConfig(cfgWrite, "", "DemoMod", "../DemoMod_Config/settings.json", settings.MergedContent); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	if err := writeModConfig(cfgWrite, "", "DemoMod", "../DemoMod_Config/brandNew.json", brandNew.MergedContent); err != nil {
		t.Fatalf("create brandNew: %v", err)
	}
	created, err := os.ReadFile(filepath.Join(mods, "DemoMod_Config", "brandNew.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(created), "fresh") {
		t.Fatalf("created file content=%s", created)
	}
}
