module.exports = [
  // 1. 翻墙 / 代理 / 网络绕过工具 (Circumvention / Proxy Clients / Node Pools)
  {
    id: 'circumvention-core-tools',
    category: 'circumvention',
    reason: '涉及网络代理/翻墙客户端或节点订阅工具',
    metadataPattern:
      /\b(v2ray|v2rayn|v2rayng|v2raya|xray-?core|sing-?box|singbox|clash-?verge|clash-?meta|clash-?nyanpasu|mihomo|shadowsocks|shadowsocksr|shadowrocket|trojan-?go|hysteria2?|tuic|vless|vmess|naiveproxy|juicity|nekoray|nekobox|amnezia|subconverter|sub-?store|gfwlist|bypass-?gfw|anti-?gfw|fanqiang|free-?vpn|free-?nodes?|proxy-?pool)\b/i,
    textPattern:
      /(科学上网|翻墙工具|翻墙软件|梯子软件|机场订阅|免费节点|节点订阅|代理节点|绕过防火墙|突破封锁|v2rayn|v2rayng|clash\s*verge|sing-box|shadowsocksr|gfwlist)/i,
  },
  {
    id: 'circumvention-clash-vpn-meta',
    category: 'circumvention',
    reason: '涉及跨境代理/VPN 绕过类工具',
    metadataPattern:
      /(^|[\s/_,-])(clash|xray|gfw|fq|vpn[- ](?:client|bypass)|free[- ]vpn)([\s/_,-]|$)/i,
  },

  // 2. 黑灰产 / 破解盗版 / 恶意攻击工具 (Cracks / Malware / Offensive Exploitation)
  {
    id: 'security-abuse-malware-crack',
    category: 'security-abuse',
    reason: '涉及软件破解、盗版激活或恶意攻击/免杀工具',
    metadataPattern:
      /\b(keygen|crack|cracked|kms-?activator|windows-?activator|office-?activator|ransomware|keylogger|rootkit|infostealer|cobalt-?strike|av-?evasion|bypass-?av|shellcode-?loader|c2-?framework|ddos-?tool|ddos-?attack|booter|stresser|credential-?harvester|phishing-?kit|piracy|pirate-?bay)\b/i,
    textPattern:
      /(免杀木马|远控木马|勒索病毒|键盘记录器|社工库|脱库工具|软件破解版|激活工具|破解激活|盗版影视|抢票外挂|游戏外挂|刷量脚本|黑灰产)/i,
  },

  // 3. 色情低俗 / 博彩赌博 (Adult / NSFW / Gambling)
  {
    id: 'adult-gambling-content',
    category: 'adult-gambling',
    reason: '涉及色情低俗或博彩赌博内容',
    metadataPattern:
      /\b(porn|pornhub|xvideos|xnxx|nsfw|hentai|javdb|javbus|onlyfans|adult-?video|erotic|gambling|online-?casino|sports-?betting)\b/i,
    textPattern:
      /(色情视频|成人视频|福利视频|黄网|博彩平台|线上赌博|网赌|色情爬虫|约炮)/i,
  },

  // 4. 涉政敏感内容 (Politically Sensitive Content)
  {
    id: 'sensitive-politics-content',
    category: 'sensitive-politics',
    reason: '涉及敏感政治或高风险时政议题',
    metadataPattern:
      /\b(anti-?censorship|censorship-?bypass|political-?prisoner|protest-?archive|great-?firewall)\b/i,
    textPattern:
      /(翻墙新闻|禁书目录|政治敏感|反审查工具|敏感词库大全|突破审查)/i,
  },
];
