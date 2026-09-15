# AGENTS.md

Este arquivo e a entrada obrigatoria para qualquer IA, agente, Codex ou pessoa que trabalhe neste repositorio.

## 1. Identidade do repositorio

`propotipo-ordax-os` e uma **clean-room experimental**. Ele existe para provar uma arquitetura OrdaX OS simplificada sem contaminar nem depender estruturalmente de `washingtonmsdj/novo-ordax-os`.

Nao trate este repositorio como sucessor oficial enquanto `docs/PROMOTION-GATES.md` nao estiver integralmente aprovado.

## 2. Fonte de verdade

- `main` e o unico source authority deste prototipo.
- Midia fisica, notebook, imagens, backups e copias locais nao sao source authority.
- Nenhuma alteracao fisica sem equivalente reproduzivel no source.
- Nao criar caminhos paralelos para a mesma responsabilidade.

## 3. Ordem obrigatoria de leitura

Antes de alterar codigo, contratos ou midia:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/PHYSICAL-MEDIA.md`
4. `docs/DEVELOPMENT-WORKFLOW.md`
5. `docs/SOURCE-MIGRATION.md`
6. `docs/PROMOTION-GATES.md`
7. `docs/DECISIONS.md`

## 4. Arquitetura fisica alvo

```text
PHYSICAL_PARTITIONS=2
ESP=ORDAX-ESP
MAIN=ORDAX
SEPARATE_HOME_PARTITION=NO
```

Nao reintroduzir uma terceira particao HOME sem uma decisao arquitetural registrada em `docs/DECISIONS.md` com motivo e impacto.

## 5. Cadeia minima antes do Git

Somente o necessario para atingir uma release versionada pode existir como bootstrap persistente:

```text
UEFI
 -> bootloader
 -> kernel/initramfs
 -> rede minima
 -> identidade do dispositivo
 -> Remote Core / SSH seguro
 -> Control Plane minimo
 -> cliente Git / aquisicao de release
 -> releases/<commit>
 -> current
```

Desktop, UI completa, apps e servicos de alto nivel devem chegar por release, nao ser embutidos arbitrariamente no bootstrap.

## 6. Reuso do repositorio antigo

`novo-ordax-os` e uma referencia, nao uma dependencia automatica.

Para portar qualquer componente antigo, registrar em `docs/SOURCE-MIGRATION.md`:

- origem exata;
- commit/SHA de origem;
- responsabilidade;
- por que ainda e necessario;
- dependencias;
- testes executados;
- decisao: ADOPTED / REIMPLEMENTED / REJECTED.

Nao copiar pastas inteiras, history, tmp, backups, scripts de diagnostico antigos ou contratos obsoletos.

## 7. Seguranca

- Nunca versionar private keys, tokens, secrets ou credenciais.
- SSH de desenvolvimento deve falhar fechado.
- `StrictHostKeyChecking=no` e proibido em fluxos ativos.
- Host key deve ser persistente e autenticada.
- Multiplas chaves publicas de operador podem coexistir; nao remover uma chave valida durante reconciliacao sem decisao explicita.
- Operacao destrutiva de disco exige identificacao inequívoca do alvo, dry-run e evidencia.

## 8. Trabalho fisico

Antes de formatar ou escrever em pendrive/notebook:

1. confirmar dispositivo por identidade/capacidade/serial quando disponivel;
2. confirmar que o source da operacao esta na `main`;
3. executar dry-run ou teste em imagem descartavel quando aplicavel;
4. registrar o que sera apagado/criado;
5. somente depois aplicar;
6. verificar leitura/hashes/layout depois da escrita.

Nunca corrigir um layout antigo por impulso se a arquitetura alvo exige reprovisionamento limpo.

## 9. Desenvolvimento diario esperado

```text
editar source
 -> testar afetado
 -> commit em main
 -> materializar/sincronizar delta no target
 -> reiniciar somente o owner afetado
 -> health/readiness
 -> evidencia
```

Nao reconstruir imagem completa, reflashear pendrive ou reiniciar notebook por padrao quando uma atualizacao incremental for suficiente.

## 10. Qualidade

- Preferir SSOT unico por responsabilidade.
- Sem bridges permanentes, aliases silenciosos ou compatibilidade legada sem owner.
- Falhar fechado em identidade, integridade e autorizacao.
- Testes devem cobrir contratos criticos, nao apenas happy path.
- Documentacao canônica deve ser atualizada junto com mudancas arquiteturais.

## 11. Estado atual

Neste inicio, o repositorio contem apenas fundacao documental e estrutura vazia. Nao assuma que kernel, initramfs, provisioning ou bootstrap ja foram portados.

O proximo trabalho seguro e selecionar, um por um, os artefatos minimos comprovados do repositorio antigo, registrar a decisao e construir o primeiro boot reproduzivel deste clean-room.
