import { InterviewTemplate, VoiceOption } from './types';

export const TEMPLATES: InterviewTemplate[] = [
  {
    id: 'promotion',
    title: '晋升答辩',
    description: '模拟P7/P8晋升答辩现场，面试官将针对你的述职报告进行深度追问。',
    defaultPrompt: '我是今年的晋升候选人，目前负责公司核心交易链路的稳定性建设。过去一年我主导了双11的高可用架构升级。'
  },
  {
    id: 'campus',
    title: '校园招聘',
    description: '模拟互联网大厂校招面试，考察计算机基础、算法以及项目经历。',
    defaultPrompt: '我是一名计算机专业的应届毕业生，主修Java后端开发，对分布式系统有浓厚兴趣。'
  },
  {
    id: 'product',
    title: '产品经理面试',
    description: '针对产品思维、需求分析和商业洞察力的专项面试。',
    defaultPrompt: '我有3年B端产品经验，主要负责CRM系统的设计与迭代。'
  }
];

export const VOICE_OPTIONS: VoiceOption[] = [
  { name: 'Kore', label: 'Kore (男声 - 沉稳)' },
  { name: 'Puck', label: 'Puck (男声 - 活泼)' },
  { name: 'Fenrir', label: 'Fenrir (男声 - 深沉)' },
  { name: 'Zephyr', label: 'Zephyr (女声 - 温柔)' },
  { name: 'Charon', label: 'Charon (男声 - 严肃)' },
];

export const DEFAULT_AVATAR = "https://picsum.photos/400/400?grayscale";