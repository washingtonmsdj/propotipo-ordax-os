package windowsadapter

import (
	"bytes"
	"io"
	"testing"
)

func TestOpenVerifiedRawImageForApplyReturnsRewoundVerifiedHandle(t *testing.T) {
	data := []byte("stable raw image handle")
	fixture := writeRawFixture(t, data)
	file, verified, err := openVerifiedRawImageForApply(fixture.Path, fixture.SHA256, fixture.SizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if verified != fixture {
		t.Fatalf("verified image = %#v, want %#v", verified, fixture)
	}
	got, err := io.ReadAll(file)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, data) {
		t.Fatalf("verified handle was not rewound: got=%q want=%q", got, data)
	}
}
