package hostinfo

import (
	"runtime"
	"time"

	"github.com/mastermind/agent/internal/client"
)

// Gather collects host metadata (CPU, RAM, disk). Stub for MVP; expand with syscall or shirou/gopsutil.
func Gather() (*client.HostMetadata, error) {
	meta := &client.HostMetadata{
		ReportedAt: time.Now().UTC(),
	}
	// CPU: model name from /proc/cpuinfo or runtime
	meta.CPU = runtime.GOARCH
	// TODO: read MemTotal/MemAvailable from /proc/meminfo on Linux; use gopsutil for cross-platform
	meta.MemTotalMB = 0
	meta.MemFreeMB = 0
	meta.DiskPath = "/"
	meta.DiskFreeMB = 0
	return meta, nil
}
