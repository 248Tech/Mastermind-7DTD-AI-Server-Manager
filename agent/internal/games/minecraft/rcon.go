package minecraft

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"net"
	"strings"
	"time"
)

// RCON packet types (Minecraft / Source RCON)
const (
	_typeAuth    = 3
	_typeCommand = 2
	_typeResponse = 0
)

// Client is a minimal Minecraft RCON client (TCP, little-endian packets).
type Client struct {
	conn     net.Conn
	requestID int32
}

// Connect opens a TCP connection and authenticates with the given password.
func Connect(host string, port int, password string, timeout time.Duration) (*Client, error) {
	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return nil, err
	}
	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		conn.Close()
		return nil, err
	}
	c := &Client{conn: conn}
	if err := c.auth(password); err != nil {
		conn.Close()
		return nil, err
	}
	return c, nil
}

func (c *Client) auth(password string) error {
	reqID := c.nextID()
	if err := c.send(reqID, _typeAuth, password); err != nil {
		return err
	}
	id, _, err := c.recv()
	if err != nil {
		return err
	}
	if id == -1 {
		return fmt.Errorf("rcon: authentication failed")
	}
	return nil
}

func (c *Client) nextID() int32 {
	c.requestID++
	return c.requestID
}

// send sends one packet: length (LE), requestId (LE), type (LE), payload (null-term), padding (1 null).
func (c *Client) send(requestID int32, typ int32, payload string) error {
	pl := []byte(payload)
	pl = append(pl, 0)
	// Packet: length(4) | requestId(4) | type(4) | payload\0 | padding(1). length = body size.
	bodyLen := 4 + 4 + len(pl) + 1
	buf := make([]byte, 4+bodyLen)
	binary.LittleEndian.PutUint32(buf[0:4], uint32(bodyLen))
	binary.LittleEndian.PutUint32(buf[4:8], uint32(requestID))
	binary.LittleEndian.PutUint32(buf[8:12], uint32(typ))
	copy(buf[12:], pl)
	buf[12+len(pl)] = 0
	_, err := c.conn.Write(buf)
	return err
}

// recv reads one packet and returns requestId, payload, error.
func (c *Client) recv() (requestID int32, payload string, err error) {
	lenBuf := make([]byte, 4)
	if _, err = c.conn.Read(lenBuf); err != nil {
		return 0, "", err
	}
	length := binary.LittleEndian.Uint32(lenBuf)
	if length > 4096+16 {
		return 0, "", fmt.Errorf("rcon: packet too large")
	}
	rest := make([]byte, length)
	if _, err = c.conn.Read(rest); err != nil {
		return 0, "", err
	}
	if length < 10 {
		return 0, "", fmt.Errorf("rcon: packet too short")
	}
	requestID = int32(binary.LittleEndian.Uint32(rest[0:4]))
	// rest[4:8] = type; rest[8:] = payload (null-terminated), then padding null
	pay := rest[8:]
	if i := bytes.IndexByte(pay, 0); i >= 0 {
		pay = pay[:i]
	}
	return requestID, string(pay), nil
}

// Exec sends a command and returns the response. For multi-packet responses we read until a small packet or timeout.
func (c *Client) Exec(command string) (string, error) {
	reqID := c.nextID()
	if err := c.send(reqID, _typeCommand, command); err != nil {
		return "", err
	}
	var out []string
	for {
		c.conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		id, payload, err := c.recv()
		if err != nil {
			if len(out) > 0 {
				return joinResponses(out), nil
			}
			return "", err
		}
		if id == reqID && payload != "" {
			out = append(out, payload)
			// If response is smaller than typical max (4096), assume done
			if len(payload) < 4000 {
				break
			}
		}
	}
	return joinResponses(out), nil
}

func joinResponses(parts []string) string {
	if len(parts) == 0 {
		return ""
	}
	if len(parts) == 1 {
		return parts[0]
	}
	return strings.Join(parts, "\n")
}

// Close closes the connection.
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
