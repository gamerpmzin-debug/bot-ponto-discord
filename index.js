import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import http from 'http'; // Pra enganar o Render
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const ID_DONO = '1476727569268084858';

const commands = [
  new SlashCommandBuilder()
 .setName('ajustar')
 .setDescription('Ajusta dados de um usuário')
 .addUserOption(option => option.setName('usuario').setDescription('Usuário').setRequired(true))
 .addStringOption(option => option.setName('campo').setDescription('Campo: pendente, status, valor').setRequired(true))
 .addStringOption(option => option.setName('valor').setDescription('Novo valor').setRequired(true)),

  new SlashCommandBuilder()
 .setName('criarcontrato')
 .setDescription('Cria um contrato')
 .addUserOption(option => option.setName('usuario').setDescription('Usuário').setRequired(true))
 .addStringOption(option => option.setName('email').setDescription('Email').setRequired(true))
 .addStringOption(option => option.setName('texto').setDescription('Texto customizado do contrato').setRequired(false)),

  new SlashCommandBuilder()
 .setName('editartextocontrato')
 .setDescription('Edita o texto padrão dos contratos - Só dono')
 .addStringOption(option => option.setName('texto').setDescription('Novo texto padrão').setRequired(true))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`Online: ${client.user.tag}`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS contratos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      email TEXT,
      data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const colunas = [
    { nome: 'texto_custom', tipo: 'TEXT' },
    { nome: 'pendente', tipo: 'INTEGER DEFAULT 0' },
    { nome: 'status', tipo: 'TEXT DEFAULT "ativo"' },
    { nome: 'valor', tipo: 'TEXT' },
    { nome: 'data', tipo: 'TEXT' }
  ];

  for (const col of colunas) {
    try {
      await db.execute(`ALTER TABLE contratos ADD COLUMN ${col.nome} ${col.tipo}`);
      console.log(`Coluna ${col.nome} adicionada`);
    } catch (err) {
      console.log(`Coluna ${col.nome} já existe`);
    }
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Comandos registrados com sucesso');
  } catch (err) {
    console.error('Erro ao registrar comandos:', err);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'ajustar') {
      const user = interaction.options.getUser('usuario');
      const campo = interaction.options.getString('campo');
      const valor = interaction.options.getString('valor');

      const camposValidos = ['pendente', 'status', 'valor', 'email'];
      if (!camposValidos.includes(campo)) {
        return interaction.reply({ content: `Campo inválido. Use: ${camposValidos.join(', ')}`, ephemeral: true });
      }

      await db.execute({
        sql: `UPDATE contratos SET ${campo} =? WHERE user_id =?`,
        args: [valor, user.id]
      });

      await interaction.reply(`Campo \`${campo}\` de ${user} ajustado pra \`${valor}\``);
    }

    if (interaction.commandName === 'criarcontrato') {
      const user = interaction.options.getUser('usuario');
      const email = interaction.options.getString('email');
      const texto = interaction.options.getString('texto');

      await db.execute({
        sql: `INSERT INTO contratos (user_id, email, texto_custom, pendente, status) VALUES (?,?,?,?,?)`,
        args: [user.id, email, texto, 0, 'ativo']
      });

      await interaction.reply(`Contrato criado pra ${user} com email \`${email}\``);
    }

    if (interaction.commandName === 'editartextocontrato') {
      if (interaction.user.id!== ID_DONO) {
        return interaction.reply({ content: 'Só o dono pode usar esse comando.', ephemeral: true });
      }

      const texto = interaction.options.getString('texto');
      await db.execute(`CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT)`);
      await db.execute({
        sql: `INSERT OR REPLACE INTO config (chave, valor) VALUES ('texto_padrao_contrato',?)`,
        args: [texto]
      });

      await interaction.reply('Texto padrão dos contratos atualizado com sucesso.');
    }

  } catch (error) {
    console.error('Erro no comando:', error);
    if (!interaction.replied) {
      await interaction.reply({ content: 'Deu erro ao executar o comando. Olha o log.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

// Dummy server pro Render parar de reclamar de porta
const server = http.createServer((req, res) => res.end('Bot online'));
server.listen(process.env.PORT || 3000);
