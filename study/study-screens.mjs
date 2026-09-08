// study-screens.mjs — participant-facing copy: consent, instructions, comprehension check.
//
// THE CONSENT TEXT BELOW IS A TEMPLATE, NOT AN APPROVED PROTOCOL. It is the wording the
// paper's study ran, with every institution-specific field removed. Replace it with text
// your own ethics board has approved before collecting data from anyone. Duration,
// compensation, contacts and review board are interpolated from study-config.json so they
// cannot drift out of sync with the protocol.
//
// Points to check against your approval, all of which differ between protocols:
//    - compensation rate and estimated duration (study-config.json "study")
//    - the questionnaire and sensitive-topics clauses, which this study does NOT have
//    - the deception clause ("you may not be told everything"), which does not apply here
//      Both are left in place because they are often protocol-wide boilerplate.
//    - the confidentiality clause ("your identity will not be stored with your data"): the
//      participant pastes a recruitment-platform ID and it is stored alongside the session,
//      which is a pseudonymous identifier, not an anonymous code number.

export function consentHtml(s) {
  return `
<p class="h">Key Information</p>
<p>The following is a short summary of this study to help you decide whether to be a part of this
   study. More detailed information is listed later in this form.</p>

<p class="h">Why am I being invited to take part in a research study?</p>
<p>We invite you to take part in a research study because you have met the eligibility criteria
   for this study. Specifically, you are an adult in the appropriate age range. As a volunteer,
   you have been asked to participate in this study because your results may help us to
   understand the brain more fully.</p>

<p class="h">What should I know about a research study?</p>
<p>• Someone will explain this research study to you.<br>
   • Whether or not you take part is up to you.<br>
   • Your participation is completely voluntary.<br>
   • You can choose not to take part.<br>
   • You can agree to take part and later change your mind.<br>
   • Your decision will not be held against you.<br>
   • Your refusal to participate will not result in any consequences or any loss of benefits that
     you are otherwise entitled to receive.<br>
   • You can ask all the questions you want before you decide.</p>

<p class="h">Why is this research being done?</p>
<p>The purpose of this study is to investigate the way people learn to play unfamiliar video
   games, and to compare human play with the behaviour of artificial agents trained on the
   same games.</p>

<p class="h">How long will the research last and what will I need to do?</p>
<p>You will play a series of short video games using your keyboard. This will take approximately
   ${s.estimatedMinutes} minutes.</p>

<p class="h">Is there any way being in this study could be bad for me?</p>
<p>The risks of this study are minimal. The games involve rapid keyboard use and moving on-screen
   graphics, which some people may find tiring. You may stop at any time.</p>

<p class="h">Will being in this study help me in any way?</p>
<p>This study provides no benefits to you individually. The study provides important information
   about the nature of learning and decision making, and about how artificial agents compare with
   people on the same tasks.</p>

<p class="h">What happens if I do not want to be in this research?</p>
<p>Participation in research is completely voluntary. You can decide to participate, not
   participate, or discontinue participation at any time without penalty or loss of benefits to
   which you are otherwise entitled. Your alternative to participating in this research study is
   to not participate.</p>

<p class="h2">Detailed Information</p>
<p>The following is more detailed information about this study in addition to the information
   listed above.</p>

<p class="h">What is the purpose of this research?</p>
<p>The study will use measures of your behaviour (your key presses and game scores) to understand
   the psychological mechanisms underlying learning and decision making, and to establish a human
   baseline against which artificial agents can be compared.</p>

<p class="h">How long will I take part in this research?</p>
<p>The study will take about ${s.estimatedMinutes} minutes (not including breaks).</p>

<p class="h">What happens if I say yes, I want to be in this research?</p>
<p>After providing informed consent and receiving instructions, the main part of the study will
   begin. Games will be presented on your personal computer and you will play each one using the
   keyboard for a fixed length of time. Because the study is taking place through a web
   interface, you will not be directly interacting with study personnel, though you may contact
   them at any time (see below). You may be contacted for future research.</p>
<p>In some cases, we may be interested in re-contacting you for additional information or to
   participate in a follow-up experiment. If we do, your participation is completely optional and
   you would be compensated appropriately for your time.</p>

<p class="h">What happens if I say yes, but I change my mind later?</p>
<p>You can leave the research at any time; it will not be held against you. If you choose to
   withdraw from the study, we will ask you for permission to continue using any data that were
   already collected. If you do not give permission, we will delete the data.</p>

<p class="h">If I take part in this research, how will my privacy be protected? What happens to the information you collect?</p>
<p>Efforts will be made to limit the use and disclosure of your Personal Information to people who
   have a need to review this information. We cannot promise complete secrecy. Organizations that
   may inspect and copy your information include the IRB and other representatives of this
   organization.</p>
<p>Your participation in this study will remain confidential, and your identity will not be stored
   with your data. Your responses will be assigned a code number, and the list connecting your
   name with this number will be kept in a locked room or in a password protected computer
   file.</p>
<p>If identifiers are removed from your identifiable private information that are collected during
   this research, that information could be used for future research studies or distributed to
   another investigator for future research studies without your additional informed consent.</p>

<p class="h">Can I be removed from the research without my OK?</p>
<p>The person in charge of the research study or the sponsor can remove you from the research
   study without your approval. Possible reasons for removal include discovering a previously
   unidentified ineligibility or failure to comply with task instructions.</p>
<p>We will tell you about any new information that may affect your health, welfare, or choice to
   stay in the research.</p>

<p class="h">Compensation</p>
<p>You will receive payment for this study at the rate of ${s.compensationRate}.</p>

<p class="h">Who can I talk to?</p>
<p>If you have questions, concerns, or complaints, or think the research has hurt you, talk to the
   research team by contacting ${s.contactName} at
   <a href="mailto:${s.contactEmail}">${s.contactEmail}</a>. You may also contact the Principal
   Investigator, ${s.piName}, at <a href="mailto:${s.piEmail}">${s.piEmail}</a>.</p>
<p>This research has been reviewed and approved by the ${s.irbName} ("IRB"). Learn more about
   the IRB and your rights as a participant on the IRB's For Research Participants webpage. You
   may contact the IRB at ${s.irbPhone} or
   <a href="mailto:${s.irbEmail}">${s.irbEmail}</a> if:</p>
<p>• Your questions, concerns, or complaints are not being answered by the research team.<br>
   • You cannot reach the research team.<br>
   • You want to talk to someone besides the research team.<br>
   • You have questions about your rights as a research subject.<br>
   • You want to get information or provide input about this research.</p>

<p class="h">Agreement:</p>
<p>The nature and purpose of this research have been sufficiently explained and I agree to
   participate in this study. I understand that I am free to withdraw at any time without
   incurring any penalty.</p>
<p>Please consent by checking the box below to continue. Otherwise, please exit the study at this
   time.</p>`;
}

// Paged instructions. Kept deliberately short: every extra page is dropout, and the
// comprehension check is what actually establishes that they understood.
export function durationPhrase(sec) {
  // "1.67 minutes" reads badly; under two minutes, say seconds.
  if (sec < 120) return `${Math.round(sec)} seconds`;
  const m = sec / 60;
  return `${Number.isInteger(m) ? m : m.toFixed(1)} minutes`;
}

export function instructionPages(cfg) {
  const nGames = cfg.nScoredBlocks;
  const blockDur = durationPhrase(cfg.blockSeconds);
  const roundSec = Math.round(cfg.maxSteps / 60);
  const nRounds = Math.floor(cfg.blockSeconds / roundSec);

  return [
    {
      title: 'What you will do',
      html: `
        <p>You will play <b>${nGames} short video games</b>, one after another. You get
           <b>${blockDur}</b> on each game.</p>
        <p>Nobody has played these games before — they were made for this study. You are not
           expected to be good at them, and there is no need to worry if you do badly.</p>
        <p>Before each game you will see a screen explaining its controls. <b>Read it</b> — the
           controls are different for each game.</p>`,
    },
    {
      title: 'Rounds and the timer',
      html: `
        <p>Your ${blockDur} on each game is split into <b>rounds</b>.</p>
        <p>A round ends when you lose, <i>or</i> when you finish it, <i>or</i> automatically
           after about <b>${roundSec} seconds</b> — whichever comes first. You will play at
           least <b>${nRounds} rounds</b> of each game, and more if your rounds end early.</p>
        <p>So there are two different clocks: <b>${blockDur} on the game</b>, and <b>up to about
           ${roundSec} seconds on any one round</b>. Losing a round is normal and costs you
           nothing — a new one starts immediately.</p>
        <p>Between rounds you will see how many points that round scored. Then the next round
           begins on its own.</p>
        <p>A timer on screen shows how much time is left on the current game. It pauses while
           you are looking at your round score, so those few seconds do not come out of your
           playing time.</p>`,
    },
    {
      title: 'Your goal',
      html: `
        <p><b>Score as many points as you can in every round.</b></p>
        <p>Because you play several rounds of each game, what matters is how well you do
           <b>across all of them</b> — not just your single best round. Keep trying for a high
           score even in the last few seconds.</p>
        <p>The top of the screen shows the round you are on, your score in that round, and your
           best round so far on that game. Your score resets when a new round begins.</p>`,
    },
    {
      title: 'Controls',
      html: `
        <p>Use <b>only the keyboard</b>: the <kbd>arrow keys</kbd> and the <kbd>space bar</kbd>.
           No other keys do anything, and you will not need the mouse once a game has started.</p>
        <p>These games accept <b>one direction at a time</b>. In some of them you also cannot
           move and act at once — for example, a ship may be able to <i>either</i> turn
           <i>or</i> thrust, but not both together. This is part of the game, not a fault. The
           controls screen before each game will tell you when this applies.</p>
        <p>Please <b>do not switch tabs or windows</b> while a game is running.</p>`,
    },
    {
      title: 'Your data',
      html: `
        <p>While you play we record only your key presses and your game scores. Your data is
           identified only by your Prolific ID, which is what lets us pay you.</p>
        <p>At the very end we ask whether anything went technically wrong — those boxes are
           optional — and a few short questions about you: your age, your gender, and how much
           you play video games. <b>“Prefer not to say” is always one of the answers</b>, and
           you will be paid whatever you answer.</p>
        <p>When you are ready, continue to a short comprehension check.</p>`,
    },
  ];
}

// ---------------------------------------------------------------------------
// End-of-study questions. Field names deliberately match the lab's video-rating study
// (Firestore end_study_feedback: demographics{age,gender,gamingExperience,gamingFrequency},
// feedback{technicalIssues,confusingParts,suggestions}) so the two studies are comparable and
// so the questions are ones the protocol has already been through the IRB with. Its
// `funCriteria` question is dropped -- it was about what makes a video fun to watch.
//
// Everything here is OPTIONAL and everything is asked AFTER all play is finished: a demographic
// question before or between blocks could plausibly change how someone plays, and none of it
// may ever gate payment.
//
// gamingExperience and gamingFrequency are not decoration for this study in particular. The
// entire claim is a NOVICE human baseline, so "how much do you play games" is the covariate a
// reviewer will ask about first, and the one that lets you show the baseline is not dominated
// by practised players.
// ---------------------------------------------------------------------------
// Each of these needs a RESPONSE, and "Prefer not to say" is one of the responses.
//
// Not optional, because at n=20 three silent skips is 15% missing on the only covariates the
// analysis has, and most of that missingness would be accidental -- people skip because a Skip
// button is there, not because they object. Not compulsory either: the consent form promises
// that refusal carries no loss of benefit, and a question that blocks payment would contradict
// it. Requiring an answer while making refusal one of the available answers is what satisfies
// both, and it is the shape IRB demographic items normally take.
//
// DECLINE_ANSWER is spelled the same way everywhere so the analysis can filter one string.
const DECLINE = 'Prefer not to say';

export function demographicQuestions() {
  return [
    {
      id: 'age', label: 'How old are you?', type: 'number', required: true,
      min: 18, max: 100, placeholder: 'age in years', decline: DECLINE,
      hint: 'Also how we confirm the study\'s 18-or-over requirement.',
    },
    {
      id: 'gender', label: 'What is your gender?', type: 'choice', required: true,
      options: ['Woman', 'Man', 'Non-binary', 'Prefer to self-describe', DECLINE],
      selfDescribe: 'Prefer to self-describe',
    },
    {
      id: 'gamingExperience', label: 'How much experience do you have with video games?',
      type: 'choice', required: true,
      options: ['None at all', 'A little', 'A moderate amount', 'A lot', 'I play very seriously', DECLINE],
    },
    {
      id: 'gamingFrequency', label: 'How often do you play video games?', type: 'choice',
      required: true,
      options: ['Never', 'A few times a year', 'A few times a month', 'A few times a week', 'Every day', DECLINE],
    },
  ];
}

export function feedbackQuestions() {
  return [
    {
      id: 'technicalIssueLevel', label: 'Did you run into any technical problems?',
      type: 'choice',
      options: ['No problems at all', 'Something minor', 'Something that affected my play'],
    },
    {
      id: 'technicalIssues', type: 'text',
      label: 'If so, what happened?',
      hint: 'Slow or stuttering games, controls not responding, a game that would not start, anything else.',
    },
    {
      id: 'confusingParts', type: 'text',
      label: 'Was anything confusing or unclear?',
      hint: 'The instructions, the controls, or a particular game.',
    },
    {
      id: 'suggestions', type: 'text',
      label: 'Anything else you want to tell us?',
      hint: 'Optional, and genuinely read.',
    },
  ];
}

// Comprehension check. Every question targets something that would corrupt the data if
// misunderstood: the round structure (or they think one loss ends the game), the goal
// (or they coast after a good round), and the one-direction-at-a-time constraint (or they
// report the harness as broken and quit).
export function quizQuestions(cfg) {
  const roundSec = Math.round(cfg.maxSteps / 60);
  const blockDur = durationPhrase(cfg.blockSeconds);

  // `page` is the instruction page that covers the question, so a wrong answer can point at
  // the right explanation instead of replaying all five pages. Pilot participants took 5 and
  // 21 attempts here, and one wrote "first one about rounds was confusing" -- the two round
  // questions are where people get stuck, so their wording is now as blunt as possible and the
  // two durations are named side by side rather than left to be inferred.
  return [
    {
      q: 'What happens when you lose a round?',
      page: 1,
      options: [
        'That game is over and you move on to the next game',
        `A new round starts straight away, and you keep playing more rounds until your ${blockDur} on that game runs out`,
        'You have to click a button to continue',
        'You lose all the points you have scored so far',
      ],
      answer: 1,
    },
    {
      q: `You get ${blockDur} on each game, split into rounds. What is the longest a single round can last?`,
      page: 1,
      options: [
        'About 5 seconds',
        `About ${roundSec} seconds, then it ends on its own and a new round starts`,
        `The whole ${blockDur} — one round per game`,
        'Until you decide to stop',
      ],
      answer: 1,
    },
    {
      q: 'What are you trying to do?',
      page: 2,
      options: [
        'Survive as long as possible without scoring',
        'Score as many points as you can in every round',
        'Finish each game as quickly as possible',
        'Get one very high score and then stop trying',
      ],
      answer: 1,
    },
    {
      q: 'In these games, can you always move in two directions at once?',
      page: 3,
      options: [
        'Yes, always',
        'No — the games accept one direction at a time',
        'Only if you press the keys quickly',
        'Only in the last round',
      ],
      answer: 1,
    },
  ];
}
