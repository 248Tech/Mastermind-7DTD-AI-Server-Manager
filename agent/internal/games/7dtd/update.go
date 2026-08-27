package sevendtd

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

const stableUpdateScript = "/usr/local/sbin/mastermind-update-7dtd-stable"

var (
	updateStatusPattern = regexp.MustCompile(`(?m)^MASTERMIND_STATUS=(current|updated|running|failed)\s*$`)
	updateBuildPattern  = regexp.MustCompile(`(?m)^MASTERMIND_BUILD_(BEFORE|AFTER)=(\S+)\s*$`)
)

type steamUpdateReport struct {
	Status string
	Before string
	After  string
	Output string
}

func parseSteamUpdateReport(output string) steamUpdateReport {
	report := steamUpdateReport{Status: "failed", Output: output}
	if match := updateStatusPattern.FindStringSubmatch(output); len(match) == 2 {
		report.Status = match[1]
	} else if strings.Contains(strings.ToLower(output), "already up to date") {
		report.Status = "current"
	} else if strings.Contains(strings.ToLower(output), "fully installed") {
		report.Status = "updated"
	}
	for _, match := range updateBuildPattern.FindAllStringSubmatch(output, -1) {
		if match[1] == "BEFORE" {
			report.Before = match[2]
		} else {
			report.After = match[2]
		}
	}
	if report.Status != "updated" && report.Before != "" && report.After != "" && report.Before != report.After && report.After != "unknown" {
		report.Status = "updated"
	}
	return report
}

func (a *Adapter) Update(ctx context.Context, cfg *agent.InstanceConfig) (agent.JobResult, error) {
	wasRunning := serviceActive(ctx, "7dtd.service")
	if wasRunning {
		agent.ReportProgress(ctx, "saving", "Saving world before the stable update")
		if _, err := a.SaveWorld(ctx, cfg); err != nil {
			return agent.JobResult{Status: "failed", Error: fmt.Sprintf("save before update: %v", err)}, nil
		}
		agent.ReportProgress(ctx, "stopping", "Stopping 7DTD so Steam can update the install")
		if err := a.Stop(ctx, cfg); err != nil {
			return agent.JobResult{Status: "failed", Error: fmt.Sprintf("stop before update: %v", err)}, nil
		}
		if err := waitFor7DTDState(ctx, false, 2*time.Minute); err != nil {
			return agent.JobResult{Status: "failed", Error: fmt.Sprintf("server did not stop before update: %v", err)}, nil
		}
	}

	agent.ReportProgress(ctx, "updating", "Checking Steam for a stable dedicated-server update")
	report, err := runStableUpdate(ctx)
	if err != nil && report.Status != "updated" && report.Status != "current" {
		if wasRunning {
			_ = a.Start(ctx, cfg)
		}
		return agent.JobResult{Status: "failed", Error: err.Error(), Output: report.Output, Result: map[string]interface{}{
			"status": report.Status, "buildBefore": report.Before, "buildAfter": report.After,
		}}, nil
	}

	started := false
	if wasRunning {
		agent.ReportProgress(ctx, "starting", "Starting 7DTD after the Steam update")
		if err := a.Start(ctx, cfg); err != nil {
			return agent.JobResult{Status: "failed", Error: fmt.Sprintf("update finished (%s) but the server did not start: %v", report.Status, err), Output: report.Output, Result: map[string]interface{}{
				"status": report.Status, "buildBefore": report.Before, "buildAfter": report.After,
			}}, nil
		}
		started = true
	}

	message := "Dedicated server is already on the latest stable build"
	if report.Status == "updated" {
		message = "Applied a stable dedicated-server update"
		if report.Before != "" && report.After != "" {
			message = fmt.Sprintf("Applied stable update %s → %s", report.Before, report.After)
		}
	}
	if started {
		message += "; server started"
	}
	return agent.JobResult{
		Status: "success",
		Output: message,
		Result: map[string]interface{}{
			"status":      report.Status,
			"buildBefore": report.Before,
			"buildAfter":  report.After,
			"started":     started,
		},
	}, nil
}

func runStableUpdate(ctx context.Context) (steamUpdateReport, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, 40*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, "/usr/bin/sudo", "-n", stableUpdateScript)
	out, err := cmd.CombinedOutput()
	output := strings.TrimSpace(string(out))
	report := parseSteamUpdateReport(output)
	if err != nil && report.Status != "current" && report.Status != "updated" {
		if report.Status == "running" {
			return report, fmt.Errorf("stop 7DTD before applying a Steam update")
		}
		if output == "" {
			return report, fmt.Errorf("stable update failed: %w", err)
		}
		return report, fmt.Errorf("stable update failed: %s", output)
	}
	if report.Status == "" {
		report.Status = "failed"
	}
	return report, nil
}
