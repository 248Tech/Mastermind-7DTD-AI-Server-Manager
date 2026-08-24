package sevendtd

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteServerConfigPropertyReplacesExisting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "serverconfig.xml")
	original := `<ServerSettings>
	<property name="ServerName" value="Test"/>
	<property name="ServerPassword" value="old"/>
</ServerSettings>
`
	if err := os.WriteFile(path, []byte(original), 0644); err != nil {
		t.Fatal(err)
	}
	if err := writeServerConfigProperty(path, "ServerPassword", "Maint1"); err != nil {
		t.Fatal(err)
	}
	got, err := readServerConfigProperty(path, "ServerPassword")
	if err != nil {
		t.Fatal(err)
	}
	if got != "Maint1" {
		t.Fatalf("got %q", got)
	}
}

func TestWriteServerConfigPropertyInsertsMissing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "serverconfig.xml")
	original := `<ServerSettings>
	<property name="ServerName" value="Test"/>
</ServerSettings>
`
	if err := os.WriteFile(path, []byte(original), 0644); err != nil {
		t.Fatal(err)
	}
	if err := writeServerConfigProperty(path, "ServerPassword", "secret"); err != nil {
		t.Fatal(err)
	}
	got, err := readServerConfigProperty(path, "ServerPassword")
	if err != nil {
		t.Fatal(err)
	}
	if got != "secret" {
		t.Fatalf("got %q", got)
	}
}
