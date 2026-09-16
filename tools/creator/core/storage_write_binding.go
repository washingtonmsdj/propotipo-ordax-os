package creatorcore

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

const physicalWriteBindingDomain = "prototype-ordax:physical-write-plan:v1\x00"

// HashPhysicalWritePlan cryptographically binds the exact target capacity,
// region geometry and bytes that the physical writer is authorized to touch.
// Capacity-only sparse space is intentionally excluded, so integrity work scales
// with the bytes actually written instead of the nominal USB size.
func HashPhysicalWritePlan(source io.ReaderAt, plan PhysicalWritePlan, report func(completedBytes, totalBytes int64)) (string, error) {
	if source == nil {
		return "", errors.New("physical write-plan source is required")
	}
	if plan.TargetBytes == 0 || plan.BytesToWrite <= 0 || len(plan.Regions) == 0 {
		return "", errors.New("physical write plan is empty")
	}

	digest := sha256.New()
	_, _ = digest.Write([]byte(physicalWriteBindingDomain))
	var word [8]byte
	binary.LittleEndian.PutUint64(word[:], plan.TargetBytes)
	_, _ = digest.Write(word[:])
	binary.LittleEndian.PutUint64(word[:], uint64(plan.BytesToWrite))
	_, _ = digest.Write(word[:])
	binary.LittleEndian.PutUint64(word[:], uint64(len(plan.Regions)))
	_, _ = digest.Write(word[:])

	var completed int64
	var previousEnd int64
	if report != nil {
		report(0, plan.BytesToWrite)
	}
	for index, region := range plan.Regions {
		if region.Role == "" || region.OffsetBytes < 0 || region.LengthBytes <= 0 {
			return "", fmt.Errorf("physical write region %d is invalid", index)
		}
		if uint64(region.OffsetBytes) > plan.TargetBytes || uint64(region.LengthBytes) > plan.TargetBytes-uint64(region.OffsetBytes) {
			return "", fmt.Errorf("physical write region %q is outside target capacity", region.Role)
		}
		if index > 0 && region.OffsetBytes < previousEnd {
			return "", fmt.Errorf("physical write region %q overlaps a previous region", region.Role)
		}
		previousEnd = region.OffsetBytes + region.LengthBytes

		role := []byte(region.Role)
		if len(role) > 1<<20 {
			return "", errors.New("physical write region role is unreasonably large")
		}
		binary.LittleEndian.PutUint64(word[:], uint64(len(role)))
		_, _ = digest.Write(word[:])
		_, _ = digest.Write(role)
		binary.LittleEndian.PutUint64(word[:], uint64(region.OffsetBytes))
		_, _ = digest.Write(word[:])
		binary.LittleEndian.PutUint64(word[:], uint64(region.LengthBytes))
		_, _ = digest.Write(word[:])

		reader := io.NewSectionReader(source, region.OffsetBytes, region.LengthBytes)
		buffer := make([]byte, 1024*1024)
		remaining := region.LengthBytes
		for remaining > 0 {
			want := int64(len(buffer))
			if remaining < want {
				want = remaining
			}
			n, err := io.ReadFull(reader, buffer[:want])
			if err != nil {
				return "", fmt.Errorf("hash physical write region %q: %w", region.Role, err)
			}
			_, _ = digest.Write(buffer[:n])
			remaining -= int64(n)
			completed += int64(n)
			if report != nil {
				report(completed, plan.BytesToWrite)
			}
		}
	}
	if completed != plan.BytesToWrite {
		return "", fmt.Errorf("physical write-plan byte total mismatch: expected=%d actual=%d", plan.BytesToWrite, completed)
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}
