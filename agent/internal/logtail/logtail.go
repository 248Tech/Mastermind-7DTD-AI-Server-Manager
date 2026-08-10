package logtail

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"os"
	"time"

	"github.com/mastermind/agent/internal/client"
)

const chunkSize = 32 * 1024

func Run(ctx context.Context, cl client.Client, hostID, serverInstanceID, path string, interval time.Duration) {
	var offset int64 = -1
	buf := make([]byte, chunkSize)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		f, err := os.Open(path)
		if err != nil {
			slog.Warn("open server log failed", "err", err)
			wait(ctx, interval)
			continue
		}
		info, _ := f.Stat()
		if offset < 0 {
			offset = info.Size() - 64*1024
			if offset < 0 {
				offset = 0
			}
		}
		if info.Size() < offset {
			offset = 0
		}
		_, _ = f.Seek(offset, io.SeekStart)
		for {
			n, readErr := f.Read(buf)
			if n > 0 {
				if err := cl.StreamLog(ctx, hostID, serverInstanceID, bytes.NewReader(buf[:n])); err != nil {
					slog.Warn("server log upload failed", "err", err)
					break
				}
				offset += int64(n)
			}
			if readErr != nil {
				break
			}
		}
		_ = f.Close()
		wait(ctx, interval)
	}
}

func wait(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
