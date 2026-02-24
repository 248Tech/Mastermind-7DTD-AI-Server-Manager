package stream

import (
	"context"
	"io"
	"os"
	"path/filepath"

	"github.com/mastermind/agent/internal/agent"
)

// FileStreamer tails a file and streams lines. Implements agent.LogStreamer.
type FileStreamer struct {
	// MaxLineLen caps line length for safety
	MaxLineLen int
}

// Supports returns true for absolute paths and paths under allowed dirs (no restriction in MVP).
func (s *FileStreamer) Supports(path string) bool {
	return filepath.IsAbs(path) || len(path) > 0
}

// Stream tails the file at path and writes content to w. Respects ctx cancellation.
// MVP: read entire file in chunks; future: fsnotify + tail -f style.
func (s *FileStreamer) Stream(ctx context.Context, path string, w io.Writer) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	// TODO: tail from end, stream new lines; for MVP simple copy with ctx check
	buf := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		n, err := f.Read(buf)
		if n > 0 {
			if _, wErr := w.Write(buf[:n]); wErr != nil {
				return wErr
			}
		}
		if err == io.EOF {
			// Optional: wait for more data (tail mode)
			break
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// Ensure FileStreamer implements agent.LogStreamer
var _ agent.LogStreamer = (*FileStreamer)(nil)
