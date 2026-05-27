import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import http from 'http';
import nodemailer from 'nodemailer';
dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ]
});

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const ID_DONO = '1476727569268084858';

// Config do Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const commands = [
  new SlashCommandBuilder().setName('iniciar').setDescription('Inicia o expediente'),
  new SlashCommandBuilder().setName('encerrar').setDescription('Encerra o expediente e salva as horas'),
  new SlashCommandBuilder().setName('pausar').setDescription('Pausa o expediente'),

  new SlashCommandBuilder()
.setName('horas')
.setDescription('Mostra as horas trabalhadas')
.addUserOption(option => option.setName('usuario').setDescription('Ver horas de outro usuário').setRequired(false)),

  new SlashCommandBuilder()
.setName('ranking')
.setDescription('Mostra o ranking de horas trabalhadas'),

  new SlashCommandBuilder()
.setName('ajustar')
.setDescription('Soma ou subtrai horas de um usuário')
.addUserOption(option => option.setName('usuario').setDescription('Usuário').setRequired(true))
.addStringOption(option =>
  option.setName('tipo')
   .setDescription('Somar ou subtrair horas')
   .setRequired(true)
   .addChoices(
      { name: 'Somar', value: 'somar' },
      { name: 'Subtrair', value: 'subtrair' }
    )
)
.addIntegerOption(option => option.setName('horas').setDescription('Quantidade de horas').setRequired(true))
.addIntegerOption(option => option.setName('minutos').setDescription('Quantidade de minutos').setRequired(true)),

  new SlashCommandBuilder()
.setName('criarcontrato')
.setDescription('Cria um contrato e envia por email + DM')
.addUserOption(option => option.setName('usuario').setDescription('Usuário').setRequired(true))
.addStringOption(option => option.setName('email').setDescription('Email').setRequired(true))
.addStringOption(option => option.setName('texto').setDescription('Texto customizado do contrato').setRequired(false)),

  new SlashCommandBuilder()
.setName('enviarcontrato')
.setDescription('Reenvia o contrato por email + DM')
.addUserOption(option => option.setName('usuario').setDescription('Usuário do contrato').setRequired(true)),

  new SlashCommandBuilder()
.setName('assinar')
.setDescription('Assina o teu contrato'),

  new SlashCommandBuilder()
.setName('deletarcontrato')
.setDescription('Deleta um contrato - Só dono')
.addUserOption(option => option.setName('usuario').setDescription('Usuário do contrato').setRequired(true)),

  new SlashCommandBuilder()
.setName('editartextocontrato')
.setDescription('Edita o texto padrão dos contratos - Só dono')
.addStringOption(option => option.setName('texto').setDescription('Novo texto padrão').setRequired(true)),

  new SlashCommandBuilder()
.setName('exportar')
.setDescription('Exporta todos os contratos pra CSV - Só dono')
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

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ponto (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      inicio DATETIME,
      fim DATETIME,
      pausa_inicio DATETIME,
      pausa_fim DATETIME,
      total_pausado INTEGER DEFAULT 0,
      status TEXT DEFAULT 'parado'
    )
  `);

  await db.execute(`CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT)`);

  const colunas = [
    { nome: 'texto_custom', tipo: 'TEXT' },
    { nome: 'pendente', tipo: 'INTEGER DEFAULT 0' },
    { nome: 'status', tipo: 'TEXT DEFAULT "ativo"' },
    { nome: 'valor', tipo: 'TEXT' },
    { nome: 'data', tipo: 'TEXT' },
    { nome: 'horas', tipo: 'INTEGER DEFAULT 0' },
    { nome: 'assinado', tipo: 'INTEGER DEFAULT 0' },
    { nome: 'data_assinatura', tipo: 'DATETIME' }
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
    const userId = interaction.user.id;

    if (interaction.commandName === 'iniciar') {
      const ponto = await db.execute({ sql: `SELECT * FROM ponto WHERE user_id =? AND status IN ('iniciado', 'pausado')`, args: [userId] });
      if (ponto.rows.length > 0) return interaction.reply({ content: 'Tu já tem um expediente iniciado.', ephemeral: true });

      await db.execute({ sql: `INSERT INTO ponto (user_id, inicio, status) VALUES (?, datetime('now'), 'iniciado')`, args: [userId] });
      await interaction.reply(`Expediente iniciado às ${new Date().toLocaleTimeString('pt-BR')}`);
    }

    if (interaction.commandName === 'pausar') {
      const ponto = await db.execute({ sql: `SELECT * FROM ponto WHERE user_id =? AND status = 'iniciado'`, args: [userId] });
      if (ponto.rows.length === 0) return interaction.reply({ content: 'Tu não tem expediente iniciado pra pausar.', ephemeral: true });

      await db.execute({ sql: `UPDATE ponto SET pausa_inicio = datetime('now'), status = 'pausado' WHERE user_id =? AND status = 'iniciado'`, args: [userId] });
      await interaction.reply(`Expediente pausado às ${new Date().toLocaleTimeString('pt-BR')}`);
    }

    if (interaction.commandName === 'encerrar') {
      const ponto = await db.execute({ sql: `SELECT * FROM ponto WHERE user_id =? AND status IN ('iniciado', 'pausado')`, args: [userId] });
      if (ponto.rows.length === 0) return interaction.reply({ content: 'Tu não tem expediente iniciado.', ephemeral: true });

      const dados = ponto.rows[0];
      let totalPausado = dados.total_pausado || 0;

      if (dados.status === 'pausado') {
        const pausaInicio = new Date(dados.pausa_inicio);
        totalPausado += Math.floor((Date.now() - pausaInicio.getTime()) / 1000);
      }

      await db.execute({
        sql: `UPDATE ponto SET fim = datetime('now'), total_pausado =?, status = 'encerrado' WHERE user_id =? AND status IN ('iniciado', 'pausado')`,
        args: [totalPausado, userId]
      });

      const inicio = new Date(dados.inicio);
      const totalSegundos = Math.floor((Date.now() - inicio.getTime()) / 1000) - totalPausado;
      const horas = Math.floor(totalSegundos / 3600);
      const minutos = Math.floor((totalSegundos % 3600) / 60);

      const horasFloat = parseFloat((totalSegundos / 3600).toFixed(2));
      await db.execute({
        sql: `UPDATE contratos SET horas = COALESCE(horas, 0) +? WHERE user_id =?`,
        args: [horasFloat, userId]
      });

      await interaction.reply(`Expediente encerrado. Total trabalhado: ${horas}h ${minutos}min. Salvei ${horasFloat}h no teu contrato.`);
    }

    if (interaction.commandName === 'horas') {
      const user = interaction.options.getUser('usuario') || interaction.user;
      const contrato = await db.execute({ sql: `SELECT horas FROM contratos WHERE user_id =?`, args: [user.id] });
      const horasContrato = contrato.rows[0]?.horas || 0;
      await interaction.reply(`${user} tem ${horasContrato}h salvas no contrato.`);
    }

    if (interaction.commandName === 'ranking') {
      const contratos = await db.execute({ sql: `SELECT user_id, horas FROM contratos WHERE horas > 0 ORDER BY horas DESC LIMIT 10` });

      if (contratos.rows.length === 0) return interaction.reply('Ninguém tem horas salvas ainda.');

      let msg = '**🏆 Ranking de Horas Salvas:**\n';
      for (let i = 0; i < contratos.rows.length; i++) {
        const c = contratos.rows[i];
        const user = await client.users.fetch(c.user_id).catch(() => null);
        msg += `${i + 1}. ${user? user.username : 'Desconhecido'} - ${c.horas}h\n`;
      }

      await interaction.reply(msg);
    }

    if (interaction.commandName === 'ajustar') {
      const user = interaction.options.getUser('usuario');
      const tipo = interaction.options.getString('tipo');
      const horas = interaction.options.getInteger('horas');
      const minutos = interaction.options.getInteger('minutos');

      const horasParaAjustar = horas + (minutos / 60);

      const contrato = await db.execute({
        sql: `SELECT horas FROM contratos WHERE user_id =?`,
        args: [user.id]
      });

      if (contrato.rows.length === 0) {
        return interaction.reply({ content: `${user} não tem contrato criado ainda.`, ephemeral: true });
      }

      const horasAtuais = contrato.rows[0]?.horas || 0;
      let horasFinais = tipo === 'somar'
       ? horasAtuais + horasParaAjustar
        : horasAtuais - horasParaAjustar;

      if (horasFinais < 0) horasFinais = 0;
      horasFinais = parseFloat(horasFinais.toFixed(2));

      await db.execute({
        sql: `UPDATE contratos SET horas =? WHERE user_id =?`,
        args: [horasFinais, user.id]
      });

      const emoji = tipo === 'somar'? '➕' : '➖';
      await interaction.reply(
        `${emoji} ${tipo === 'somar'? 'Adicionei' : 'Removi'} **${horas}h ${minutos}min** de ${user}.\n` +
        `Horas antes: \`${horasAtuais}h\`\n` +
        `Horas agora: \`${horasFinais}h\``
      );
    }

    if (interaction.commandName === 'criarcontrato') {
      await interaction.deferReply();
      const user = interaction.options.getUser('usuario');
      const email = interaction.options.getString('email');
      const texto = interaction.options.getString('texto');

      await db.execute({
        sql: `INSERT INTO contratos (user_id, email, texto_custom, pendente, status, horas, assinado) VALUES (?,?,?,?,?,?,?)`,
        args: [user.id, email, texto, 0, 'ativo', 0, 0]
      });

      let textoFinal = texto;
      if (!texto) {
        const config = await db.execute({ sql: `SELECT valor FROM config WHERE chave = 'texto_padrao_contrato'` });
        textoFinal = config.rows[0]?.valor || 'Contrato padrão da empresa.';
      }

      let msgFinal = `Contrato criado pra ${user}`;

      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: email,
          subject: `Contrato - ${user.username}`,
          text: textoFinal + '\n\nPara assinar, use o comando /assinar no Discord.'
        });
        msgFinal += `, enviado no email \`${email}\``;
      } catch (err) {
        console.error('Erro email:', err);
        msgFinal += `. Deu erro ao enviar email`;
      }

      try {
        await user.send({
          content: `**📄 Teu contrato chegou:**\n\n${textoFinal}\n\n✅ Para assinar, usa \`/assinar\` aqui no servidor.`
        });
        msgFinal += ` e na DM dele.`;
      } catch (err) {
        msgFinal += `. Não consegui mandar na DM - ele deve ter DM fechada.`;
      }

      await interaction.editReply(msgFinal);
    }

    if (interaction.commandName === 'enviarcontrato') {
      await interaction.deferReply({ ephemeral: true });
      const user = interaction.options.getUser('usuario');

      const contrato = await db.execute({ sql: `SELECT * FROM contratos WHERE user_id =?`, args: [user.id] });
      if (contrato.rows.length === 0) return interaction.editReply(`${user} não tem contrato criado.`);

      const dados = contrato.rows[0];
      let textoFinal = dados.texto_custom;
      if (!textoFinal) {
        const config = await db.execute({ sql: `SELECT valor FROM config WHERE chave = 'texto_padrao_contrato'` });
        textoFinal = config.rows[0]?.valor || 'Contrato padrão da empresa.';
      }

      let msgFinal = `Contrato reenviado`;

      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: dados.email,
          subject: `Contrato - ${user.username}`,
          text: textoFinal + '\n\nPara assinar, use o comando /assinar no Discord.'
        });
        msgFinal += ` pro email \`${dados.email}\``;
      } catch (err) {
        console.error('Erro email:', err);
        msgFinal += `. Erro no email`;
      }

      try {
        await user.send({
          content: `**📄 Teu contrato chegou:**\n\n${textoFinal}\n\n✅ Para assinar, usa \`/assinar\` aqui no servidor.`
        });
        msgFinal += ` e na DM dele.`;
      } catch (err) {
        msgFinal += `. Não consegui mandar na DM - DM fechada.`;
      }

      await interaction.editReply(msgFinal);
    }

    if (interaction.commandName === 'assinar') {
      const contrato = await db.execute({ sql: `SELECT * FROM contratos WHERE user_id =?`, args: [userId] });
      if (contrato.rows.length === 0) return interaction.reply({ content: 'Tu não tem contrato pra assinar.', ephemeral: true });
      if (contrato.rows[0].assinado === 1) return interaction.reply({ content: 'Teu contrato já foi assinado.', ephemeral: true });

      await db.execute({
        sql: `UPDATE contratos SET assinado = 1, data_assinatura = datetime('now') WHERE user_id =?`,
        args: [userId]
      });

      await interaction.reply(`Contrato assinado com sucesso em ${new Date().toLocaleString('pt-BR')}!`);
    }

    if (interaction.commandName === 'deletarcontrato') {
      if (interaction.user.id!== ID_DONO) {
        return interaction.reply({ content: 'Só o dono pode usar esse comando.', ephemeral: true });
      }

      const user = interaction.options.getUser('usuario');
      const result = await db.execute({ sql: `DELETE FROM contratos WHERE user_id =?`, args: [user.id] });

      if (result.rowsAffected === 0) {
        return interaction.reply({ content: `${user} não tinha contrato.`, ephemeral: true });
      }

      await interaction.reply(`Contrato de ${user} deletado com sucesso.`);
    }

    if (interaction.commandName === 'editartextocontrato') {
      if (interaction.user.id!== ID_DONO) {
        return interaction.reply({ content: 'Só o dono pode usar esse comando.', ephemeral: true });
      }

      const texto = interaction.options.getString('texto');
      await db.execute({
        sql: `INSERT OR REPLACE INTO config (chave, valor) VALUES ('texto_padrao_contrato',?)`,
        args: [texto]
      });

      await interaction.reply('Texto padrão dos contratos atualizado com sucesso.');
    }

    if (interaction.commandName === 'exportar') {
      if (interaction.user.id!== ID_DONO) {
        return interaction.reply({ content: 'Só o dono pode usar esse comando.', ephemeral: true });
      }

      await interaction.deferReply();

      const contratos = await db.execute(`SELECT * FROM contratos`);

      if (contratos.rows.length === 0) {
        return interaction.editReply('Nenhum contrato pra exportar.');
      }

      let csv = 'ID,User ID,Email,Pendente,Status,Valor,Horas,Assinado,Data Assinatura,Data Criacao\n';
      for (const c of contratos.rows) {
        csv += `${c.id},"${c.user_id}","${c.email || ''}",${c.pendente || 0},"${c.status || ''}","${c.valor || ''}",${c.horas || 0},${c.assinado || 0},"${c.data_assinatura || ''}","${c.data_criacao}"\n`;
      }

      const buffer = Buffer.from(csv, 'utf-8');
      const attachment = new AttachmentBuilder(buffer, { name: `contratos_${Date.now()}.csv` });

      await interaction.editReply({ content: 'Aqui está o export dos contratos:', files: [attachment] });
    }

  } catch (error) {
    console.error('Erro no comando:', error);
    if (!interaction.replied &&!interaction.deferred) {
      await interaction.reply({ content: 'Deu erro ao executar o comando. Olha o log.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

const server = http.createServer((req, res) => res.end('Bot online'));
server.listen(process.env.PORT || 3000);
