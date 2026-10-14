import type {ReactNode} from 'react'
import Link from '@docusaurus/Link'
import Layout from '@theme/Layout'
import Heading from '@theme/Heading'
import Translate, {translate} from '@docusaurus/Translate'
import styles from './index.module.css'

const paths = [
  {id: 'play', title: <Translate id="homepage.path.play.title">Play your first story</Translate>, text: <Translate id="homepage.path.play.text">Install the bundle, configure one model route, and begin with the included world.</Translate>, to: '/docs/getting-started/installation'},
  {id: 'author', title: <Translate id="homepage.path.author.title">Author a world</Translate>, text: <Translate id="homepage.path.author.text">Build characters, places, factions and plots visually, with an assistant, or directly in files.</Translate>, to: '/docs/authoring/overview'},
  {id: 'understand', title: <Translate id="homepage.path.understand.title">Understand the system</Translate>, text: <Translate id="homepage.path.understand.text">See how agents, deterministic gates, memory and story state cooperate through a turn.</Translate>, to: '/docs/concepts/orchestration'},
]

const capabilities = [
  [<Translate id="homepage.capability.memory.title">Memory & perception</Translate>, <Translate id="homepage.capability.memory.text">Layered recall without omniscient characters</Translate>],
  [<Translate id="homepage.capability.world.title">Living world</Translate>, <Translate id="homepage.capability.world.text">Time, routines, factions and off-stage action</Translate>],
  [<Translate id="homepage.capability.author.title">Authoring</Translate>, <Translate id="homepage.capability.author.text">Visual editor, agent and SillyTavern import</Translate>],
  [<Translate id="homepage.capability.media.title">Media & voice</Translate>, <Translate id="homepage.capability.media.text">Images, portraits, speech and transcription</Translate>],
]

function Arrow({diagonal = false}: {diagonal?: boolean}): ReactNode {
  return <svg className={styles.arrowIcon} viewBox="0 0 18 18" aria-hidden="true">
    {diagonal ? <path d="M4 14 14 4m-7 0h7v7" /> : <path d="M3 9h11m-4-4 4 4-4 4" />}
  </svg>
}

function StoryRoute(): ReactNode {
  return <div className={styles.route} aria-label={translate({id: 'homepage.route.label', message: 'Example of one action becoming a durable story change'})}>
    <svg className={styles.routeLine} viewBox="0 0 620 390" aria-hidden="true"><path d="M65 308 C138 308 130 211 224 211 S332 112 417 112 S494 55 561 55" /><path className={styles.routeEcho} d="M65 324 C154 324 162 246 239 246 S339 148 426 148 S502 89 561 89" /></svg>
    <div className={`${styles.routeNode} ${styles.routeStart}`}><span>1</span><b><Translate id="homepage.route.action">Player action</Translate></b><small><Translate id="homepage.route.action.detail">Ask Mara about the key</Translate></small></div>
    <div className={`${styles.routeNode} ${styles.routeDecision}`}><span>2</span><b><Translate id="homepage.route.decision">Mara decides</Translate></b><small><Translate id="homepage.route.decision.detail">Recall → judge → answer</Translate></small></div>
    <div className={`${styles.routeNode} ${styles.routeState}`}><span>3</span><b><Translate id="homepage.route.state">World changes</Translate></b><small><Translate id="homepage.route.state.detail">Door unlocked · time advances</Translate></small></div>
    <aside className={`${styles.mapNote} ${styles.memoryNote}`}><b><Translate id="homepage.route.memory">Private memory</Translate></b><span><Translate id="homepage.route.memory.detail">Mara remembers the west stair. Elias does not.</Translate></span></aside>
    <aside className={`${styles.mapNote} ${styles.commitNote}`}><b><Translate id="homepage.route.commit">State committed</Translate></b><span><Translate id="homepage.route.commit.detail">19:40 · storm begins · west door unlocked</Translate></span></aside>
    <div className={styles.storyClock}><span className={styles.clockBefore}><Translate id="homepage.route.clock.before">Story time · 19:35</Translate></span><span className={styles.clockAfter}><Translate id="homepage.route.clock">Story time · 19:40</Translate></span></div>
    <div className={styles.illustrative}><Translate id="homepage.route.illustrative">Illustrative turn</Translate></div>
    <div className={styles.mapKey}><span><i className={styles.known} /> <Translate id="homepage.route.known">perceived</Translate></span><span><i /> <Translate id="homepage.route.unknown">unknown</Translate></span><span><i className={styles.durable} /> <Translate id="homepage.route.durable">durable change</Translate></span></div>
  </div>
}

export default function Home(): ReactNode {
  return <Layout title={translate({id: 'homepage.meta.title', message: 'Persistent agentic roleplay'})} description={translate({id: 'homepage.meta.description', message: 'Agent-driven roleplay, world authoring and persistent story state for DeepSeek Harness.'})}>
    <main className={styles.page}>
      <section className={styles.hero}><div className={styles.folio}>
        <div className={styles.heroCopy}>
          <Heading as="h1"><Translate id="homepage.hero.title">A world that remembers what happened.</Translate></Heading>
          <p className={styles.lead}><Translate id="homepage.hero.lead">Install one bundle. Create a world. Play an open-ended story where characters act from their own knowledge—and consequences stay written into the world.</Translate></p>
          <div className={styles.actions}><Link className={styles.primaryAction} to="/docs/getting-started/installation"><Translate id="homepage.hero.start">Start with the guide</Translate></Link><Link className={styles.secondaryAction} to="/docs/concepts/orchestration"><Translate id="homepage.hero.how">See how it works</Translate><Arrow /></Link></div>
          <p className={styles.compatibility}><Translate id="homepage.hero.compatibility">Made for DSH 0.2.x · Optimised for local models</Translate></p>
        </div><StoryRoute />
      </div></section>

      <section className={styles.pathSection} aria-labelledby="choose-path"><div className={styles.sectionHeading}>
        <Heading as="h2" id="choose-path"><Translate id="homepage.paths.title">Choose where to begin</Translate></Heading><p><Translate id="homepage.paths.text">The short path gets a story running. The deeper paths remain there when you need them.</Translate></p>
      </div><div className={styles.pathList}>{paths.map((path, index) => <Link className={styles.path} to={path.to} key={path.id}><span className={styles.pathNumber}>{String(index + 1).padStart(2, '0')}</span><span><Heading as="h3">{path.title}</Heading><p>{path.text}</p></span><Arrow diagonal /></Link>)}</div></section>

      <section className={styles.mechanism} aria-labelledby="coherent-world"><div className={styles.mechanismIntro}>
        <Heading as="h2" id="coherent-world"><Translate id="homepage.mechanism.title">Creative decisions. Reliable consequences.</Translate></Heading><p><Translate id="homepage.mechanism.text">Models improvise dialogue and intent. Deterministic code validates important changes, scopes what each character can know, and records what the next turn must remember.</Translate></p><Link to="/docs/concepts/memory-knowledge"><Translate id="homepage.mechanism.link">Explore memory and knowledge</Translate><Arrow /></Link>
      </div><ol className={styles.turnFlow}>
        <li><b><Translate id="homepage.flow.observe">Observe</Translate></b><span><Translate id="homepage.flow.observe.text">Give each character only their perspective.</Translate></span></li>
        <li><b><Translate id="homepage.flow.decide">Decide</Translate></b><span><Translate id="homepage.flow.decide.text">Let bounded agents choose what they do.</Translate></span></li>
        <li><b><Translate id="homepage.flow.validate">Validate</Translate></b><span><Translate id="homepage.flow.validate.text">Gate movement, time and state through code.</Translate></span></li>
        <li><b><Translate id="homepage.flow.remember">Remember</Translate></b><span><Translate id="homepage.flow.remember.text">Persist events, perceptions and beliefs.</Translate></span></li>
      </ol></section>

      <section className={styles.bundle} aria-labelledby="one-bundle"><div className={styles.bundleHeading}><Heading as="h2" id="one-bundle"><Translate id="homepage.bundle.title">One bundle, the whole workshop.</Translate></Heading><p><Translate id="homepage.bundle.text">Stay inside DSH from first world to long-running story.</Translate></p></div><dl>{capabilities.map(([title, text], index) => <div key={index}><dt>{title}</dt><dd>{text}</dd></div>)}</dl></section>

      <section className={styles.closing}><Heading as="h2"><Translate id="homepage.closing.title">Begin with the included world. Make the next one yours.</Translate></Heading><p><Translate id="homepage.closing.text">Only a language model is required. Add retrieval, images and voice when you want them.</Translate></p><Link className={styles.primaryAction} to="/docs/getting-started/installation"><Translate id="homepage.closing.action">Install DSH Agentic Roleplay</Translate></Link></section>
    </main>
  </Layout>
}
