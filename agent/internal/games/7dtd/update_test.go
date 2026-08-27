package sevendtd

import "testing"

func TestParseSteamUpdateReportCurrent(t *testing.T) {
	report := parseSteamUpdateReport("MASTERMIND_BUILD_BEFORE=199999\nSuccess! App '294420' already up to date.\nMASTERMIND_BUILD_AFTER=199999\nMASTERMIND_STATUS=current\n")
	if report.Status != "current" || report.Before != "199999" || report.After != "199999" {
		t.Fatalf("report=%+v", report)
	}
}

func TestParseSteamUpdateReportUpdated(t *testing.T) {
	report := parseSteamUpdateReport("MASTERMIND_BUILD_BEFORE=100\nSuccess! App '294420' fully installed.\nMASTERMIND_BUILD_AFTER=200\nMASTERMIND_STATUS=updated\n")
	if report.Status != "updated" || report.Before != "100" || report.After != "200" {
		t.Fatalf("report=%+v", report)
	}
}

func TestParseSteamUpdateReportInfersUpdatedFromBuildIDs(t *testing.T) {
	report := parseSteamUpdateReport("MASTERMIND_BUILD_BEFORE=100\nMASTERMIND_BUILD_AFTER=200\n")
	if report.Status != "updated" {
		t.Fatalf("status=%s", report.Status)
	}
}
