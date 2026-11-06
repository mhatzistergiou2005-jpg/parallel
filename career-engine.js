(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  root.CareerEngine = engine;
})(globalThis, function () {
  const skillSignals = {
    creative: ['creative', 'story', 'design', 'visual', 'ideat', 'content', 'brand', 'writing', 'copy'],
    analysis: ['analysis', 'data', 'research', 'problem', 'reason', 'evidence', 'numer', 'test', 'insight', 'decision', 'finance', 'report'],
    communication: ['communication', 'writing', 'presentation', 'listening', 'relationship', 'community', 'facilitation', 'explaining', 'advocacy', 'interview', 'copy'],
    organization: ['organization', 'planning', 'coordination', 'detail', 'accuracy', 'project', 'delivery', 'systems', 'structure'],
    research: ['research', 'investigation', 'curiosity', 'evidence', 'interview', 'analysis', 'insight']
  };

  function selectedAnswers(answers) {
    return Object.values(answers || {}).flat().filter(value => typeof value === 'string');
  }

  function rankCareers(careers, answers) {
    const chosen = selectedAnswers(answers);
    if (!chosen.length) return [];
    return Object.entries(careers).map(([name, career]) => {
      const matchedSignals = [...new Set(chosen.filter(answer => career.signals.includes(answer)))];
      const score = matchedSignals.reduce((total, signal) => total + chosen.filter(answer => answer === signal).length, 0);
      return { name, career, score, matchedSignals, percent: Math.min(96, 52 + score * 7) };
    }).filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  function groupSkills(career, answers) {
    const signals = new Set(selectedAnswers(answers));
    const entries = Object.entries(career.skills || {});
    const have = [];
    const grow = [];
    for (const entry of entries) {
      const normalizedName = entry[0].toLowerCase();
      const isStrength = [...signals].some(signal =>
        (skillSignals[signal] || [signal]).some(hint => normalizedName.includes(hint))
      );
      (isStrength ? have : grow).push(entry);
    }
    return { have, grow };
  }

  function learningItems(career, growSkills) {
    const items = [...(career.learn || [])];
    const nextSkill = growSkills[0]?.[0];
    if (nextSkill) {
      items.push([
        `Practice ${nextSkill}`,
        `Build ${nextSkill.toLowerCase()} for ${career.tags[0]} by applying it to a small, finished project.`,
        'Skill practice',
        'Beginner',
        '1 week'
      ]);
    }
    items.push([
      'Create portfolio evidence',
      `Make one small, shareable example that demonstrates your ability to work on ${career.tags[0]}.`,
      'Practice',
      'Beginner',
      '1 week'
    ]);
    return items;
  }

  function buildRoadmap(careerName, career, growSkills) {
    const focusSkill = growSkills[0]?.[0] || Object.keys(career.skills || {})[0] || 'your core skills';
    const learningTitle = career.learn?.[0]?.[0] || `Foundations of ${careerName}`;
    return [
      {
        month: 'MONTH 1',
        title: 'Learn',
        text: `Build your foundations for ${careerName} and strengthen ${focusSkill}.`,
        tasks: [`Explore three roles in ${careerName}`, `Complete: ${learningTitle}`, `Keep notes on where ${careerName} fits your interests`]
      },
      {
        month: 'MONTH 2',
        title: 'Practice',
        text: `Turn your learning into evidence of ${focusSkill}.`,
        tasks: [`Complete a small ${careerName} project using ${focusSkill}`, 'Ask one trusted person for specific feedback', 'Save the project and write down what you learned']
      },
      {
        month: 'MONTH 3',
        title: 'Launch',
        text: `Use your ${careerName} project to take a practical next step.`,
        tasks: [`Add your project and ${focusSkill} evidence to your CV or portfolio`, `Speak with someone working in ${careerName}`, 'Choose one next learning goal from your remaining skill gaps']
      }
    ];
  }

  return { rankCareers, groupSkills, learningItems, buildRoadmap };
});
