package sevendtd

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNextAvailableModFolder(t *testing.T) {
	root := t.TempDir()
	mustMkdir := func(name string) {
		if err := os.MkdirAll(filepath.Join(root, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	mustMkdir("ServerTools")
	got, err := nextAvailableModFolder(root, "ServerTools")
	if err != nil || got != "ServerTools (1)" {
		t.Fatalf("got=%q err=%v", got, err)
	}
	mustMkdir("ServerTools (1)")
	got, err = nextAvailableModFolder(root, "ServerTools")
	if err != nil || got != "ServerTools (2)" {
		t.Fatalf("got=%q err=%v", got, err)
	}
	got, err = nextAvailableModFolder(root, "NewMod")
	if err != nil || got != "NewMod" {
		t.Fatalf("got=%q err=%v", got, err)
	}
}

func TestDeriveModFolderFromArchiveName(t *testing.T) {
	if got := deriveModFolderFromArchiveName("My Cool Mod.zip"); got != "My_Cool_Mod" {
		t.Fatalf("got=%q", got)
	}
}
