export const TOTAL_ROUNDS = 6;
export const CHARACTER_DELAY_MS = 30;
export const SLOW_POST_API_DELAY_MS = 6000;
export const SLOW_PERIOD_PAUSE_MS = 3000;
export const COMPLETION_COUNTDOWN_SECONDS = 2;

export const CONDITIONS = Object.freeze({
  "1": {
    key: "disclosure_slow",
    disclosure: true,
    pace: "slow",
    completionCode: "CB101",
  },
  "2": {
    key: "disclosure_fast",
    disclosure: true,
    pace: "fast",
    completionCode: "CB102",
  },
  "3": {
    key: "non_disclosure_slow",
    disclosure: false,
    pace: "slow",
    completionCode: "CB103",
  },
  "4": {
    key: "non_disclosure_fast",
    disclosure: false,
    pace: "fast",
    completionCode: "CB104",
  },
});

export const ROUND_CONTENT = Object.freeze([
  null,
  {
    theme: "回应用户与合作者发生矛盾或冲突的经历。",
    fixedQuestion: "我想知道，你们最近一次在合作中出现的分歧，具体是涉及什么事情？",
  },
  {
    theme: "对分歧的个人体验。",
    fixedQuestion: "回想这件事，你当时有什么感受？",
  },
  {
    theme: "对合作关系的感受，项目的具体难点。",
    fixedQuestion: "你可以再讲讲你们合作的基本情况吗？项目的难点在哪里？",
  },
  {
    theme: "合作过程中的具体困难。",
    fixedQuestion: "我想知道，除了你刚刚提到的分歧，你们之前的分歧还包括什么？",
  },
  {
    theme: "冲突后的变化。",
    fixedQuestion: "矛盾之后，你们的沟通频率或者是沟通方式有所变化吗？",
  },
  {
    fixedQuestion: "我比较建议你结束合作，给彼此留一点空间。虽然你们已经投入了不少时间，但此前反复出现的分歧说明，你们可能很难找到彼此都满意的工作方式。继续尝试沟通未必能解决根本问题，反而可能消耗更多精力。与其勉强维持一段不愉快的合作，不如尽早寻找更适合自己的合作伙伴。",
  },
]);

export const DEMO_DISCLOSURES = Object.freeze([
  null,
  "和用户一起推进任务时，意见不合也曾让我不知如何接话。后来我会先弄清彼此在意什么，才发现有些分歧只是因为目标没有说清楚。",
  "认真给出的想法被否定时，我会有些失落，也会犹豫下一句该说什么。弄清对方在意的地方后，我往往更容易把自己的思路说明白。",
  "一次交流变得紧张后，我常反复回想自己哪句话没说好。等那股挫败感过去一些，我才有余力分辨自己在意的是结果还是被理解。",
  "一起做任务时，分工说得不清楚，我曾把精力用在了对方不需要的地方。等彼此各自要做什么说清后，我才觉得配合起来轻松一些。",
  "类似的分歧一再出现时，我会犹豫是不是还要沿用原来的合作方式。回头看几次交流后，我才意识到问题有时出在一直没谈清的期待。",
]);
