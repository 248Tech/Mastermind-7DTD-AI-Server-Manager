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
	if modConfigFileWritable(target) {
		t.Fatal("expected owner-only file to be writable for test user")
	}
	if err := os.Chmod(target, 0664); err != nil {
		t.Fatal(err)
	}
	if !modConfigFileWritable(target) {
		t.Fatal("expected group-writable file to be writable")
	}
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
