import type {ReactNode} from 'react'
import Link from '@docusaurus/Link'
import Layout from '@theme/Layout'
import Heading from '@theme/Heading'
import Translate, {translate} from '@docusaurus/Translate'
import styles from './index.module.css'

const paths = [
  {
    title: <Translate id="homepage.path.play.title">Play</Translate>,
    text: <Translate id="homepage.path.play.text">Install the bundle, configure AI services and start a persistent story.</Translate>,
    to: '/docs/getting-started/installation',
  },
  {
    title: <Translate id="homepage.path.author.title">Author worlds</Translate>,
    text: <Translate id="homepage.path.author.text">Create characters, places, factions, lore and plots in the editor or with an approval-gated assistant.</Translate>,
    to: '/docs/authoring/overview',
  },
  {
    title: <Translate id="homepage.path.develop.title">Develop plugins</Translate>,
    text: <Translate id="homepage.path.develop.text">Use roleplay state, records and extension points from another DSH plugin.</Translate>,
    to: '/docs/developers/architecture',
  },
]

const highlights = [
  {
    title: <Translate id="homepage.highlight.perspective.title">Characters with a point of view</Translate>,
    text: <Translate id="homepage.highlight.perspective.text">Relationships, private knowledge, perceptions and memories shape what each character decides.</Translate>,
  },
  {
    title: <Translate id="homepage.highlight.persistence.title">A world that keeps its consequences</Translate>,
    text: <Translate id="homepage.highlight.persistence.text">Time, movement, possessions, promises, beliefs and plot progress survive beyond the current prompt.</Translate>,
  },
  {
    title: <Translate id="homepage.highlight.freedom.title">Direction without railroading</Translate>,
    text: <Translate id="homepage.highlight.freedom.text">Plots and triggers give the GM material to use while free-form actions decide where the story goes.</Translate>,
  },
  {
    title: <Translate id="homepage.highlight.authoring.title">Author without leaving DSH</Translate>,
    text: <Translate id="homepage.highlight.authoring.text">Edit visually, work with an approval-gated authoring agent, or keep full control of the files.</Translate>,
  },
]

export default function Home(): ReactNode {
  return <Layout
    title={translate({id: 'homepage.meta.title', message: 'Persistent agentic roleplay'})}
    description={translate({id: 'homepage.meta.description', message: 'Agent-driven roleplay, world authoring and persistent story state for DeepSeek Harness.'})}>
    <header className={styles.hero}>
      <div className="container">
        <p className={styles.eyebrow}><Translate id="homepage.hero.eyebrow">DeepSeek Harness plugin bundle</Translate></p>
        <Heading as="h1"><Translate id="homepage.hero.title">Stories whose characters can act for themselves</Translate></Heading>
        <p className={styles.lead}><Translate id="homepage.hero.lead">Create a world, choose who to become, and play an open-ended story where characters remember, decide and change.</Translate></p>
        <div className={styles.actions}>
          <Link className="button button--primary button--lg" to="/docs/intro"><Translate id="homepage.hero.documentation">Read the documentation</Translate></Link>
          <Link className="button button--secondary button--lg" href="https://github.com/Firefox2100/dsh-agentic-roleplay"><Translate id="homepage.hero.github">View on GitHub</Translate></Link>
        </div>
      </div>
    </header>
    <main className={'container ' + styles.main}>
      <section className={styles.introduction}>
        <Heading as="h2"><Translate id="homepage.introduction.title">More than a character chat</Translate></Heading>
        <p><Translate id="homepage.introduction.text">A game master coordinates independent character agents over structured story state. The setting remains editable, every session develops separately, and optional speech and images can bring scenes to life.</Translate></p>
      </section>
      <div className={styles.highlights}>{highlights.map((highlight, index) => <article className={styles.highlight} key={index}><Heading as="h3">{highlight.title}</Heading><p>{highlight.text}</p></article>)}</div>
      <div className={styles.grid}>{paths.map(path => <Link className={styles.card} to={path.to} key={path.to}><Heading as="h2">{path.title}</Heading><p>{path.text}</p><span><Translate id="homepage.path.continue">Continue</Translate> →</span></Link>)}</div>
      <section className={styles.summary}>
        <Heading as="h2"><Translate id="homepage.summary.title">Agentic by design</Translate></Heading>
        <p><Translate id="homepage.summary.text">The world supplies identities, facts and possibilities—not a fixed dialogue tree. The GM coordinates autonomous character agents while session state records relationships, knowledge, memories, time, items and consequences. Start with the included sample, then reshape it or build something entirely your own.</Translate></p>
      </section>
    </main>
  </Layout>
}
