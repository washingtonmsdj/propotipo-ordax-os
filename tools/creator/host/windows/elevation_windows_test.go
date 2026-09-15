//go:build windows && ordax_raw_backend

package windowsadapter

import "testing"

func TestTokenElevationInformationClassMatchesWinnt(t *testing.T) {
	if tokenElevationInfoClass != 20 {
		t.Fatalf("TokenElevation information class = %d, want 20", tokenElevationInfoClass)
	}
}

func TestDecodeTokenElevationAcceptsElevatedToken(t *testing.T) {
	elevated, err := decodeTokenElevation(1, 4)
	if err != nil {
		t.Fatal(err)
	}
	if !elevated {
		t.Fatal("nonzero TOKEN_ELEVATION.TokenIsElevated must report elevated")
	}
}

func TestDecodeTokenElevationAcceptsLimitedToken(t *testing.T) {
	elevated, err := decodeTokenElevation(0, 4)
	if err != nil {
		t.Fatal(err)
	}
	if elevated {
		t.Fatal("zero TOKEN_ELEVATION.TokenIsElevated must report not elevated")
	}
}

func TestDecodeTokenElevationRejectsShortResponse(t *testing.T) {
	if _, err := decodeTokenElevation(1, 3); err == nil {
		t.Fatal("short TOKEN_ELEVATION response must fail closed")
	}
}
