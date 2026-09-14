# Configuração do operador

Este sistema roda localmente. O banco SQLite, o perfil do Chrome, as capturas e todos os segredos ficam fora do Git.

## 1. Requisitos

- Node.js 24 LTS
- Git
- Chrome estável
- pnpm 12.4.1

No terminal:

~~~bash
corepack enable
corepack prepare pnpm@12.4.1 --activate
git clone https://github.com/scholzelab-cmd/PROSPEC-O.git
cd PROSPEC-O
pnpm install
cp .env.example .env
pnpm setup:business
~~~

No Windows PowerShell, use Copy-Item .env.example .env no lugar de cp.

Edite config/business.json e substitua todos os placeholders pelos dados do negócio fornecidos ao projeto. Esse arquivo é ignorado pelo Git. Enquanto houver placeholder, a automação permanece pausada. Como o link do grupo de afiliados ainda não foi informado, o encaminhamento de afiliados fica bloqueado até esse campo receber uma URL válida.

## 2. Chave da OpenAI

1. Abra [API Keys](https://platform.openai.com/api-keys).
2. Crie um projeto separado para esta automação.
3. Crie uma chave do projeto com permissão Restricted e libere somente os endpoints e modelos realmente usados.
4. Informe a chave em OPENAI_API_KEY.
5. Preencha OPENAI_MODEL e OPENAI_MODEL_FAST com nomes exatos de modelos fixos. Não use um alias que possa mudar sozinho.
6. Em Settings → Limits, configure o menor orçamento mensal adequado.
7. Defina o mesmo teto local em OPENAI_MONTHLY_BUDGET_USD.
8. Preencha os preços por milhão de tokens para o painel calcular custo.

A documentação atual da OpenAI descreve o orçamento do projeto como um limiar de gasto suave. Por isso o sistema também aplica um corte rígido local antes de cada chamada. Fonte: [gerenciamento de projetos na plataforma da API](https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform-with-projects).

## 3. Chrome dedicado com CDP

O Chrome 136 ou superior exige remote-debugging-port junto de user-data-dir apontando para um diretório que não seja o perfil padrão. Fonte: [mudança de segurança do Chrome](https://developer.chrome.com/blog/remote-debugging-port).

Feche qualquer instância anterior que esteja usando a mesma pasta e execute um dos comandos abaixo a partir da raiz do projeto.

### macOS

~~~bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   --remote-debugging-address=127.0.0.1   --remote-debugging-port=9222   --user-data-dir="$PWD/.chrome-profile"
~~~

### Linux

~~~bash
google-chrome   --remote-debugging-address=127.0.0.1   --remote-debugging-port=9222   --user-data-dir="$PWD/.chrome-profile"
~~~

Se o executável tiver outro nome, tente google-chrome-stable ou chromium.

### Windows PowerShell

~~~powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$PWD\.chrome-profile"
~~~

Entre no Instagram manualmente uma única vez nesse perfil. Não use seu perfil pessoal.

Aviso crítico: a porta de depuração dá controle total sobre a sessão logada. Mantenha CHROME_CDP_URL em 127.0.0.1, nunca use 0.0.0.0 e nunca rode em máquina compartilhada. Não encaminhe essa porta por roteador, túnel ou firewall.

## 4. Meta e webhook oficial

A arquitetura implementa duas fases:

1. a primeira DM usa a aba exclusiva do agente no Chrome;
2. somente depois de uma mensagem recebida o canal passa, atomicamente, para a API oficial.

A documentação atual da Meta informa que uma mensagem recebida dispara um evento entregue ao webhook e lista /<IG_ID>/messages ou /me/messages como endpoints de envio. Consulte [Messaging API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api) e [configuração de webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks).

No painel da Meta:

1. crie ou selecione um app Business;
2. conecte a conta profissional do Instagram;
3. solicite as permissões oficiais exigidas pelo produto, incluindo instagram_business_manage_messages quando aplicável;
4. obtenha o ID da conta profissional e o token correspondente;
5. preencha INSTAGRAM_BUSINESS_ACCOUNT_ID, INSTAGRAM_PAGE_ACCESS_TOKEN e uma versão explícita em INSTAGRAM_GRAPH_API_VERSION;
6. crie um token aleatório para INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
7. configure o callback HTTPS público para https://SEU-ENDERECO/api/webhooks/instagram;
8. assine o campo messages;
9. coloque o segredo do app em INSTAGRAM_APP_SECRET.

Para desenvolvimento local, exponha apenas a rota HTTP do aplicativo por um túnel HTTPS confiável. Nunca exponha a porta 9222 do Chrome.

A API não tenta abrir conversa fria. Janela expirada, permissão ausente, webhook indisponível ou conflito de propriedade vira exceção; o navegador não é usado como contorno.

## 5. Primeiro início

Rode painel e worker com um único comando:

~~~bash
pnpm dev
~~~

Abra http://localhost:3000.

A instalação nasce pausada. Faça nesta ordem:

1. confirme Configurações → credenciais;
2. cadastre um perfil de teste controlado;
3. execute Teste real sem envio;
4. confira a captura e o snapshot em screenshots/;
5. mantenha BROWSER_SEND_ENABLED=false até validar tudo;
6. para um piloto autorizado, mude para true, reinicie o comando e digite AUTORIZAR PILOTO na tela do lead;
7. use apenas um destinatário controlado no primeiro smoke test;
8. acompanhe Fila de jobs, Exceções e Integrações;
9. retome a operação no botão Retomar.

O sistema nunca abre outro Chrome se a conexão CDP falhar. Ele registra browser_unavailable, pausa a fila e encerra apenas a aba que criou.

## 6. Pausar e retomar

Use Pausar tudo na visão geral ou em Configurações. A pausa impede novos jobs de serem reivindicados; o estado permanece no SQLite após reinício.

Para uma emergência, pare também o processo com Ctrl+C. Ao subir novamente, jobs interrompidos voltam à fila depois de STALE_JOB_MINUTES.

## 7. Testes

~~~bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
~~~

O teste E2E usa SQLite real em memória, cliente CDP falso e transporte HTTP falso. Ele comprova descoberta sem duplicidade, primeira DM simulada, webhook idempotente, handoff exclusivo para API, resposta sem duplicidade, experimento e recuperação após reinício. Nenhuma mensagem real é enviada.

O dry-run real precisa do Chrome local. O smoke test real somente ocorre pela autorização explícita na tela e com BROWSER_SEND_ENABLED=true.

## 8. Backup e restauração

O worker agenda backup diário em backups/ e valida uma cópia antes de considerar o job concluído.

Criar e verificar agora:

~~~bash
pnpm backup
~~~

Testar o backup mais recente:

~~~bash
pnpm restore:test
~~~

Testar um arquivo específico:

~~~bash
pnpm restore:test backups/NOME-DO-ARQUIVO.db
~~~

Para restaurar:

1. pause o sistema;
2. encerre pnpm dev;
3. execute o comando abaixo;
4. rode pnpm restore:test no arquivo restaurado;
5. inicie novamente e confira o painel.

~~~bash
pnpm restore backups/NOME-DO-ARQUIVO.db RESTORE
~~~

O comando preserva o banco anterior com o sufixo before-restore em vez de apagá-lo.

## 9. Se uma chave vazar

1. pause o sistema imediatamente;
2. revogue a chave no provedor;
3. gere uma nova chave com o menor privilégio possível;
4. atualize somente o .env local;
5. reinicie o processo;
6. revise audit_log, ai_calls, integration_health e a fila de exceções;
7. se o segredo do webhook vazar, troque-o também no app da Meta;
8. se a porta CDP foi exposta, encerre o Chrome dedicado, remova a sessão pelo Instagram e recrie o perfil dedicado.

Nunca envie .env, config/business.json, .chrome-profile, banco, backup, screenshot ou trace ao Git.
