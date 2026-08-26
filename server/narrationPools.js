const pools = Object.freeze({
  'player:eliminated.common': [
    '{attacker} atropela {target}! Eliminação limpa e pressão total na arena!',
    '{target} caiu! {attacker} não perdoa e mantém o ritmo insano!',
    '{attacker} apaga {target} do mapa! Execução rápida e brutal!',
    'É eliminação! {attacker} vence o duelo contra {target} sem hesitar!',
    '{target} está fora! {attacker} acelera e domina esse confronto!',
    'Que pancada! {attacker} manda {target} direto para fora da rodada!'
  ],
  'player:eliminated.hazard': [
    '{target} foi engolido pelo perigo! A arena cobra caro cada erro!',
    'O mapa puniu {target}! Hazard perfeito e eliminação confirmada!',
    '{target} não escapou da zona de perigo! Fim de linha!',
    'A arena fecha a conta de {target}! Hazard sem misericórdia!',
    '{target} caiu para o ambiente! Pressão máxima em cada metro!',
    'Perigo confirmado! {target} é eliminado pela própria arena!'
  ],
  'player:eliminated.streak': [
    '{attacker} está em sequência! Já são {streak} eliminações e ninguém segura!',
    'Streak de {streak}! {attacker} virou uma máquina de eliminações!',
    '{attacker} pega fogo! {streak} eliminações e a arena sente a pressão!',
    'Sequência monstruosa de {attacker}: {streak} eliminações e contando!',
    '{streak} abates! {attacker} está atropelando todo mundo nesta rodada!',
    '{attacker} dispara no placar! Streak de {streak} eliminações!'
  ],
  'player:healed': [
    '{player} recupera {heal} de vida e volta inteiro para a briga!',
    'Cura confirmada! {player} respira e retorna com força total!',
    '{player} ganha fôlego! Mais {heal} de vida no meio do caos!',
    'Recuperação rápida para {player}! A luta ainda está completamente aberta!',
    '{player} se recompõe e recusa cair! Cura de {heal} pontos!',
    'Vida recuperada! {player} volta para o combate sem recuar!'
  ],
  'round:started': [
    'Rodada {round} começou! {players} combatentes entram para disputar cada ponto!',
    'Portões abertos! Rodada {round}, {players} jogadores e pressão máxima!',
    'Começou a guerra neon! Rodada {round} valendo agora!',
    'Arena liberada! Rodada {round} começa em ritmo máximo!',
    'Rodada {round} no ar! Ninguém tem espaço para erro agora!',
    'Sinal verde! {players} combatentes entram vivos na rodada {round}!'
  ],
  'round:ended': [
    'Fim de rodada! {winner} fecha a conta e lidera o placar!',
    '{winner} conquista a rodada! Resultado confirmado na arena neon!',
    'Rodada encerrada! {winner} sai por cima depois do caos!',
    'Acabou! {winner} domina o resultado final desta rodada!',
    'Placar fechado! {winner} fica no topo quando a poeira baixa!',
    'Último sinal! {winner} confirma a vitória desta rodada!'
  ],
  'meteor:impacted': [
    'Meteoro no chão! {hits} combatentes sentiram o impacto da arena!',
    'Impacto confirmado! O meteoro explode e muda o espaço da luta!',
    'BUM! Meteoro atingiu a zona e obrigou todo mundo a reagir!',
    'A arena treme! Meteoro no alvo com {hits} combatentes atingidos!',
    'Chuva cósmica confirmada! O impacto abre espaço no campo!',
    'Meteoro detonou! Quem ficou na área sentiu a pressão!'
  ],
  'bounty:claimed': [
    '{attacker} captura a bounty! Recompensa tripla, três vezes os pontos!',
    'CAÇADA CONCLUÍDA! {attacker} derruba {target} e leva pontuação 3x!',
    '{attacker} cobra a recompensa! Bounty confirmada com multiplicador triplo!',
    'Alvo abatido! {attacker} reivindica a bounty e pontua três vezes!',
    'Bounty coletada por {attacker}! O placar recebe um impacto triplo!',
    '{target} caiu como alvo marcado! {attacker} garante a recompensa 3x!'
  ],
  'boss:attacked.attack-warning': [
    'COLOSSUS prepara ataque pesado! Saiam da área marcada agora!',
    'Alerta máximo! O COLOSSUS travou o alvo e vai descarregar!',
    'Ataque do COLOSSUS chegando! A zona marcada virou território proibido!',
    'Aviso vermelho! COLOSSUS armou o golpe e a arena precisa reagir!',
    'COLOSSUS carrega o ataque! Movimento imediato ou vem impacto!',
    'Zona marcada! O próximo golpe do COLOSSUS já está armado!'
  ],
  'boss:attacked.attack-resolved': [
    'Golpe do COLOSSUS resolvido! A arena sobrevive e continua pressionando!',
    'Impacto do chefe confirmado! Quem ficou perto sentiu a pancada!',
    'COLOSSUS descarrega o ataque! Combate continua sem pausa!',
    'Ataque concluído! O COLOSSUS tenta quebrar a formação da arena!',
    'Explosão do chefe resolvida! Agora é hora de contra-atacar!',
    'O golpe caiu! COLOSSUS mantém a arena sob pressão máxima!'
  ],
  'boss:spawned': [
    'COLOSSUS NEON chegou! A arena inteira precisa unir fogo contra o gigante!',
    'Alerta de chefe! COLOSSUS NEON invade a arena e muda completamente a rodada!',
    'O gigante acordou! COLOSSUS NEON está ativo e quer dominar o mapa!',
    'Chefe na arena! Todos contra o COLOSSUS NEON a partir de agora!',
    'COLOSSUS NEON entrou pesado! Cooperação total para derrubar essa máquina!',
    'A arena ganhou um monstro! COLOSSUS NEON está oficialmente em combate!'
  ],
  'boss:defeated': [
    'COLOSSUS NEON caiu! A arena inteira desmontou o gigante em equipe!',
    'Chefe derrotado! Cooperação perfeita derruba o COLOSSUS NEON!',
    'Acabou para o gigante! A arena vence o COLOSSUS NEON!',
    'COLOSSUS no chão! Pressão coletiva fecha uma luta gigantesca!',
    'Vitória da arena! COLOSSUS NEON não aguentou o ataque conjunto!',
    'O gigante desaba! COLOSSUS NEON foi destruído pelo esforço coletivo!'
  ],
  'gift:epic': [
    '{sender} ativa {gift}! A arena inteira sente o peso desse momento!',
    '{gift} na arena por {sender}! O nível da batalha acabou de subir!',
    '{sender} solta {gift}! Evento gigante confirmado na transmissão!',
    'Momento épico! {sender} dispara {gift} e muda o clima da arena!',
    '{gift} ativado por {sender}! Todo mundo presta atenção agora!',
    'A transmissão explode! {sender} manda {gift} e acende a arena!'
  ]
});

const recentByCategory = new Map();
const HISTORY_SIZE = 3;

const interpolate = (template, values = {}) => template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => String(values[key] ?? ''));

export function pickNarration(category, values = {}, random = Math.random) {
  const variants = pools[category] || [];
  if (!variants.length) return '';
  const recent = recentByCategory.get(category) || [];
  const available = variants.filter((phrase) => !recent.includes(phrase));
  const choices = available.length ? available : variants;
  const index = Math.min(choices.length - 1, Math.max(0, Math.floor(Number(random()) * choices.length)));
  const selected = choices[index];
  const nextHistory = [selected, ...recent.filter((phrase) => phrase !== selected)].slice(0, HISTORY_SIZE);
  recentByCategory.set(category, nextHistory);
  return interpolate(selected, values).replace(/\s+/g, ' ').trim();
}

export const narrationPoolCounts = Object.freeze(Object.fromEntries(Object.entries(pools).map(([category, phrases]) => [category, phrases.length])));

export function resetNarrationHistory() { recentByCategory.clear(); }
export const narrationPools = pools;
