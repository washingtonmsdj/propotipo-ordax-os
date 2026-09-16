//go:build windows && !ordax_owner_prototype

package main

func ownerPrototypePhysicalBackend() (string, bool) {
	return "", false
}
