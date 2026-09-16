//go:build windows

package main

import (
	"fmt"

	componentchannel "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/componentchannel"
	creatorupdate "github.com/washingtonmsdj/prototipo-ordax-os/tools/creator/update"
)

func finishRefreshState(result appRefreshState, backendDirectory string) appRefreshState {
	if backendDirectory == "" {
		return result
	}
	result.BackendDirectory = backendDirectory

	targets, ready, targetErr := loadTargets(backendDirectory)
	if targetErr != nil {
		if result.Error == "" {
			result.Error = targetErr.Error()
		} else {
			result.Error += "\n" + targetErr.Error()
		}
		return result
	}
	result.Targets = targets
	result.PhysicalReady = ready
	return result
}

// resolveRefreshState keeps each distribution channel isolated. The
// write-enabled owner prototype is a self-contained package: it must not
// download or depend on the creator-dev payload before it can create a USB.
// Normal development and future official-trust builds retain their existing
// independently verified component channels.
func resolveRefreshState() appRefreshState {
	if ownerDirectory, owner := ownerPrototypePhysicalBackend(); owner {
		result := appRefreshState{BackendDirectory: ownerDirectory}
		if version, sourceCommit, ok := ownerPrototypeBuildInfo(); ok {
			result.Version = version
			result.SourceCommit = sourceCommit
		}
		return finishRefreshState(result, ownerDirectory)
	}

	result := appRefreshState{}
	backendDirectory := ""

	if trust, trustSHA, official := physicalTrustBinding(); official {
		installed, changed, err := componentchannel.AcquireCached(nil, "", "", trust, trustSHA)
		if err != nil {
			current, currentErr := componentchannel.Current("", trust, trustSHA)
			if currentErr != nil {
				result.Error = fmt.Sprintf("O canal oficial assinado de componentes não está disponível: %v", err)
			} else {
				installed = current
				result.Error = fmt.Sprintf("Sem atualização do componente oficial; usando a última versão assinada válida. %v", err)
			}
		}
		if installed.Version != "" {
			result.Version = installed.Version
			result.SourceCommit = installed.SourceCommit
			result.Updated = changed
			backendDirectory = installed.Directory
		}
	} else {
		installed, changed, err := creatorupdate.Ensure(nil, "", "")
		if err != nil {
			current, currentErr := creatorupdate.Current("")
			if currentErr != nil {
				result.Error = fmt.Sprintf("Não foi possível atualizar o Creator e nenhuma versão válida está instalada: %v", err)
			} else {
				installed = current
				result.Error = fmt.Sprintf("Sem atualização de rede; usando a última versão válida. %v", err)
			}
		}
		if installed.Version != "" {
			result.Version = installed.Version
			result.SourceCommit = installed.SourceCommit
			result.Updated = changed
			backendDirectory = installed.Directory
		}
	}

	// A physical backend can override only after its independent purpose-bound
	// signature, trust, anti-rollback and file-integrity checks have succeeded.
	if physicalDirectory, ok := resolvePhysicalBackend(); ok {
		backendDirectory = physicalDirectory
	}
	return finishRefreshState(result, backendDirectory)
}
