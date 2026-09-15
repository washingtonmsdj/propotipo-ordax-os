package windowsadapter

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func writeRawFixture(t *testing.T, data []byte) VerifiedRawImage {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ordax.raw")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	return VerifiedRawImage{
		Path:      path,
		SizeBytes: int64(len(data)),
		SHA256:    hex.EncodeToString(digest[:]),
	}
}

func targetForRawImage(image VerifiedRawImage) Target {
	return FinalizeTarget(Target{
		DriveLetter:       "E:",
		VolumeLabel:       "ORDAXTEST",
		VolumeSerial:      0xabcddcba,
		DiskNumber:        9,
		VolumeBytes:       uint64(image.SizeBytes),
		PhysicalDiskBytes: uint64(image.SizeBytes),
		DeviceRemovable:   false,
		DeviceSerial:      "USB-RAW-APPLY-1",
	}, DriveTypeFixed, true, BusTypeUSB, false)
}

func TestVerifyRawImageChecksSizeAndDigest(t *testing.T) {
	fixture := writeRawFixture(t, []byte("ordax raw image fixture"))
	verified, err := VerifyRawImage(fixture.Path, fixture.SHA256, fixture.SizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	if verified != fixture {
		t.Fatalf("verified image = %#v, want %#v", verified, fixture)
	}
	if _, err := VerifyRawImage(fixture.Path, fixture.SHA256, fixture.SizeBytes+1); err == nil {
		t.Fatal("size mismatch must fail")
	}
	if _, err := VerifyRawImage(fixture.Path, "0"+fixture.SHA256[1:], fixture.SizeBytes); err == nil {
		t.Fatal("digest mismatch must fail")
	}
}

func TestVerifyRawImageRejectsSymlink(t *testing.T) {
	fixture := writeRawFixture(t, []byte("source"))
	link := filepath.Join(t.TempDir(), "link.raw")
	if err := os.Symlink(fixture.Path, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := VerifyRawImage(link, fixture.SHA256, fixture.SizeBytes); err == nil {
		t.Fatal("symlink raw image must fail")
	}
}

func TestDestructiveAuthorizationBindsTargetAndImage(t *testing.T) {
	image := writeRawFixture(t, []byte("image-a"))
	target := targetForRawImage(image)
	token := DestructiveAuthorizationToken(target, image)
	if len(token) != 64 {
		t.Fatalf("authorization token length = %d", len(token))
	}

	changedTarget := target
	changedTarget.DiskNumber++
	changedTarget.ConfirmationToken = ConfirmationToken(changedTarget)
	if token == DestructiveAuthorizationToken(changedTarget, image) {
		t.Fatal("authorization must change with target identity")
	}

	changedCapacity := target
	changedCapacity.PhysicalDiskBytes++
	changedCapacity.ConfirmationToken = ConfirmationToken(changedCapacity)
	if token == DestructiveAuthorizationToken(changedCapacity, image) {
		t.Fatal("authorization must change with physical device capacity")
	}

	otherImage := writeRawFixture(t, []byte("image-b"))
	if token == DestructiveAuthorizationToken(target, otherImage) {
		t.Fatal("authorization must change with image identity")
	}
}

func TestValidateRawDiskApplyRequestFailsClosedUntilTrustAndAuthorizationMatch(t *testing.T) {
	image := writeRawFixture(t, []byte("verified image"))
	target := targetForRawImage(image)
	request := RawDiskApplyRequest{
		Target:            target,
		ConfirmationToken: target.ConfirmationToken,
		Image:             image,
	}
	if err := ValidateRawDiskApplyRequest(request); err == nil {
		t.Fatal("unresolved trust must block physical write")
	}

	request.CanonicalTrustResolved = true
	if err := ValidateRawDiskApplyRequest(request); err == nil {
		t.Fatal("missing destructive authorization must block physical write")
	}

	request.DestructiveAuthorization = DestructiveAuthorizationToken(target, image)
	if err := ValidateRawDiskApplyRequest(request); err != nil {
		t.Fatalf("fully bound request rejected: %v", err)
	}

	request.ConfirmationToken = "0" + target.ConfirmationToken[1:]
	if err := ValidateRawDiskApplyRequest(request); err == nil {
		t.Fatal("stale target confirmation must block physical write")
	}
}

func TestValidateRawDiskApplyRequestRejectsImageGeometryMismatch(t *testing.T) {
	image := writeRawFixture(t, []byte("verified image geometry"))
	target := targetForRawImage(image)
	target.PhysicalDiskBytes++
	target.ConfirmationToken = ConfirmationToken(target)
	request := RawDiskApplyRequest{
		Target:                   target,
		ConfirmationToken:        target.ConfirmationToken,
		Image:                    image,
		CanonicalTrustResolved:   true,
		DestructiveAuthorization: DestructiveAuthorizationToken(target, image),
	}
	if err := ValidateRawDiskApplyRequest(request); err == nil {
		t.Fatal("full-disk image/device size mismatch must block physical write")
	}
}

func TestStreamRawImageVerifiedChecksBytesWhileWriting(t *testing.T) {
	data := []byte("streamed raw image bytes")
	digest := sha256.Sum256(data)
	expected := hex.EncodeToString(digest[:])
	var destination bytes.Buffer
	written, err := streamRawImageVerified(bytes.NewReader(data), &destination, expected, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if written != int64(len(data)) || !bytes.Equal(destination.Bytes(), data) {
		t.Fatal("streamed bytes differ from source")
	}

	var grownDestination bytes.Buffer
	if _, err := streamRawImageVerified(bytes.NewReader(append(data, 'x')), &grownDestination, expected, int64(len(data))); err == nil {
		t.Fatal("source growth during streaming must fail")
	}
	if grownDestination.Len() != len(data) {
		t.Fatalf("source growth wrote %d bytes, expected exactly %d authorized bytes", grownDestination.Len(), len(data))
	}
}
