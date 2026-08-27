package sevendtd

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"
)

func TestSendTelnetClosesNormalSessionWithExit(t *testing.T) {
	lines := make(chan []string, 1)
	addr, closeServer := testTelnetServer(t, func(conn net.Conn) {
		defer conn.Close()
		_, _ = conn.Write([]byte("7DTD ready\r\n"))
		reader := bufio.NewReader(conn)
		command, _ := reader.ReadString('\n')
		_, _ = conn.Write([]byte("command complete\r\n"))
		exit, _ := reader.ReadString('\n')
		lines <- []string{strings.TrimSpace(command), strings.TrimSpace(exit)}
	})
	defer closeServer()

	host, port := splitTestTelnetAddress(t, addr)
	out, err := sendTelnet(context.Background(), host, port, "", "version")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "command complete") {
		t.Fatalf("unexpected response %q", out)
	}
	if got := <-lines; strings.Join(got, ",") != "version,exit" {
		t.Fatalf("commands = %#v", got)
	}
}

func TestSendTelnetAuthenticatesAndDoesNotExitShutdown(t *testing.T) {
	lines := make(chan []string, 1)
	addr, closeServer := testTelnetServer(t, func(conn net.Conn) {
		defer conn.Close()
		_, _ = conn.Write([]byte("password:\r\n"))
		reader := bufio.NewReader(conn)
		password, _ := reader.ReadString('\n')
		_, _ = conn.Write([]byte("authenticated\r\n"))
		command, _ := reader.ReadString('\n')
		lines <- []string{strings.TrimSpace(password), strings.TrimSpace(command)}
	})
	defer closeServer()

	host, port := splitTestTelnetAddress(t, addr)
	if _, err := sendTelnet(context.Background(), host, port, "secret", "shutdown"); err != nil {
		t.Fatal(err)
	}
	if got := <-lines; strings.Join(got, ",") != "secret,shutdown" {
		t.Fatalf("commands = %#v", got)
	}
}

func TestSendTelnetCancellationInterruptsRead(t *testing.T) {
	addr, closeServer := testTelnetServer(t, func(conn net.Conn) {
		defer conn.Close()
		_, _ = conn.Write([]byte("7DTD ready\r\n"))
		reader := bufio.NewReader(conn)
		_, _ = reader.ReadString('\n')
		time.Sleep(time.Second)
	})
	defer closeServer()

	host, port := splitTestTelnetAddress(t, addr)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	started := time.Now()
	_, err := sendTelnet(ctx, host, port, "", "version")
	if err != context.Canceled {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("cancellation took %s", elapsed)
	}
}

func testTelnetServer(t *testing.T, handler func(net.Conn)) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := listener.Accept()
		if err == nil {
			handler(conn)
		}
	}()
	return listener.Addr().String(), func() {
		_ = listener.Close()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatal("test Telnet server did not stop")
		}
	}
}

func splitTestTelnetAddress(t *testing.T, address string) (string, int) {
	t.Helper()
	host, value, err := net.SplitHostPort(address)
	if err != nil {
		t.Fatal(err)
	}
	var port int
	if _, err := fmt.Sscanf(value, "%d", &port); err != nil {
		t.Fatal(err)
	}
	return host, port
}
