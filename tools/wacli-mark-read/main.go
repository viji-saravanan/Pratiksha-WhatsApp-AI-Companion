package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type repeatedStrings []string

func (values *repeatedStrings) String() string {
	return strings.Join(*values, ",")
}

func (values *repeatedStrings) Set(value string) error {
	for _, part := range strings.Split(value, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			*values = append(*values, trimmed)
		}
	}
	return nil
}

type envelope struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   interface{} `json:"error,omitempty"`
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout io.Writer, stderr io.Writer) int {
	var ids repeatedStrings
	var storeDir string
	var chatRaw string
	var senderRaw string
	var timestampRaw string
	var timeoutRaw string
	var jsonOutput bool

	fs := flag.NewFlagSet("wacli-mark-read", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.StringVar(&storeDir, "store", "", "wacli store directory")
	fs.StringVar(&chatRaw, "chat", "", "chat JID")
	fs.StringVar(&senderRaw, "sender", "", "sender JID for group receipts")
	fs.StringVar(&timestampRaw, "timestamp", "", "read timestamp in RFC3339 format")
	fs.StringVar(&timeoutRaw, "timeout", "5s", "connect and mark-read timeout")
	fs.BoolVar(&jsonOutput, "json", false, "emit JSON output")
	fs.Var(&ids, "id", "message ID to mark read; may be repeated or comma separated")

	if err := fs.Parse(args); err != nil {
		return writeFailure(stdout, stderr, jsonOutput, err)
	}

	if strings.TrimSpace(storeDir) == "" {
		return writeFailure(stdout, stderr, jsonOutput, errors.New("--store is required"))
	}
	if strings.TrimSpace(chatRaw) == "" {
		return writeFailure(stdout, stderr, jsonOutput, errors.New("--chat is required"))
	}
	if len(ids) == 0 {
		return writeFailure(stdout, stderr, jsonOutput, errors.New("at least one --id is required"))
	}

	timeout, err := time.ParseDuration(timeoutRaw)
	if err != nil || timeout <= 0 {
		return writeFailure(stdout, stderr, jsonOutput, fmt.Errorf("invalid --timeout: %s", timeoutRaw))
	}

	markedAt := time.Now().UTC()
	if strings.TrimSpace(timestampRaw) != "" {
		markedAt, err = time.Parse(time.RFC3339, timestampRaw)
		if err != nil {
			return writeFailure(stdout, stderr, jsonOutput, fmt.Errorf("invalid --timestamp: %w", err))
		}
	}

	chat, err := types.ParseJID(chatRaw)
	if err != nil {
		return writeFailure(stdout, stderr, jsonOutput, fmt.Errorf("invalid --chat JID: %w", err))
	}

	sender := types.EmptyJID
	if strings.TrimSpace(senderRaw) != "" {
		sender, err = types.ParseJID(senderRaw)
		if err != nil {
			return writeFailure(stdout, stderr, jsonOutput, fmt.Errorf("invalid --sender JID: %w", err))
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	sessionPath := filepath.Join(storeDir, "session.db")
	dbLog := waLog.Stdout("Database", "ERROR", true)
	container, err := sqlstore.New(ctx, "sqlite3", fmt.Sprintf("file:%s?_foreign_keys=on", sessionPath), dbLog)
	if err != nil {
		return writeFailure(stdout, stderr, jsonOutput, fmt.Errorf("open whatsmeow store: %w", err))
	}

	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return writeFailure(stdout, stderr, jsonOutput, errors.New("not authenticated; run wacli auth"))
		}
		return writeFailure(stdout, stderr, jsonOutput, fmt.Errorf("load device store: %w", err))
	}
	if deviceStore.ID == nil {
		return writeFailure(stdout, stderr, jsonOutput, errors.New("not authenticated; run wacli auth"))
	}

	clientLog := waLog.Stdout("Client", "ERROR", true)
	client := whatsmeow.NewClient(deviceStore, clientLog)
	if err := client.ConnectContext(ctx); err != nil {
		return writeFailure(stdout, stderr, jsonOutput, fmt.Errorf("connect whatsapp: %w", err))
	}
	defer client.Disconnect()

	if err := client.MarkRead(ctx, []types.MessageID(ids), markedAt, chat, sender); err != nil {
		return writeFailure(stdout, stderr, jsonOutput, fmt.Errorf("mark read: %w", err))
	}

	return writeSuccess(stdout, jsonOutput, map[string]interface{}{
		"chatId":     chat.String(),
		"messageIds": []string(ids),
		"markedAt":   markedAt.Format(time.RFC3339),
	})
}

func writeSuccess(stdout io.Writer, jsonOutput bool, data interface{}) int {
	if jsonOutput {
		_ = json.NewEncoder(stdout).Encode(envelope{Success: true, Data: data})
		return 0
	}
	fmt.Fprintln(stdout, "marked read")
	return 0
}

func writeFailure(stdout io.Writer, stderr io.Writer, jsonOutput bool, err error) int {
	fmt.Fprintln(stderr, err.Error())
	if jsonOutput {
		_ = json.NewEncoder(stdout).Encode(envelope{
			Success: false,
			Error: map[string]string{
				"message": err.Error(),
			},
		})
	}
	return 1
}
