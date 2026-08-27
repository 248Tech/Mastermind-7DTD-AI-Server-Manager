package heartbeat

import (
	"context"
	"net"
	"testing"
	"time"
)

func TestProbeEndpointClosesTelnetCleanly(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	done := make(chan string, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			done <- "accept error"
			return
		}
		defer conn.Close()
		_, _ = conn.Write([]byte("*** Connected with 7DTD server.\n"))
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		buf := make([]byte, 16)
		n, err := conn.Read(buf)
		if err != nil {
			done <- "read error"
			return
		}
		if string(buf[:n]) != "exit\n" {
			done <- string(buf[:n])
			return
		}
		_, _ = conn.Write([]byte("remaining banner"))
		done <- "exit\n"
	}()

	ok, _ := probeEndpoint(context.Background(), GameProbe{
		Address:      listener.Addr().String(),
		Timeout:      time.Second,
		CloseCommand: "exit",
	})
	if !ok {
		t.Fatal("probe should succeed")
	}
	select {
	case got := <-done:
		if got != "exit\n" {
			t.Fatalf("close command = %q", got)
		}
	case <-time.After(time.Second):
		t.Fatal("server did not receive close command")
	}
}
