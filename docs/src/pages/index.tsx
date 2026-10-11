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

export default function Home(): ReactNode {
  return <Layout
    title={translate({id: 'homepage.meta.title', message: 'Persistent agentic roleplay'})}
    description={translate({id: 'homepage.meta.description', message: 'Agent-driven roleplay, world authoring and persistent story state for DeepSeek Harness.'})}>
    <header className={styles.hero}>
      <div className="container">
        <p className={styles.eyebrow}><Translate id="homepage.hero.eyebrow">DeepSeek Harness plugin bundle</Translate></p>
        <Heading as="h1"><Translate id="homepage.hero.title">Stories whose characters can act for themselves</Translate></Heading>
        <p className={styles.lead}><Translate id="homepage.hero.lead">Build editable worlds, play through a game-master agent, and preserve what every character knows, remembers and changes.</Translate></p>
        <div className={styles.actions}>
          <Link className="button button--primary button--lg" to="/docs/intro"><Translate id="homepage.hero.documentation">Read the documentation</Translate></Link>
          <Link className="button button--secondary button--lg" href="https://github.com/Firefox2100/dsh-agentic-roleplay"><Translate id="homepage.hero.github">View on GitHub</Translate></Link>
        </div>
      </div>
    </header>
    <main className={'container ' + styles.main}>
      <div className={styles.grid}>{paths.map(path => <Link className={styles.card} to={path.to} key={path.to}><Heading as="h2">{path.title}</Heading><p>{path.text}</p><span><Translate id="homepage.path.continue">Continue</Translate> →</span></Link>)}</div>
      <section className={styles.summary}>
        <Heading as="h2"><Translate id="homepage.summary.title">Agentic by design</Translate></Heading>
        <p><Translate id="homepage.summary.text">The world supplies identities, facts and possibilities—not a fixed dialogue tree. The GM coordinates autonomous character agents while session state records relationships, knowledge, memories, time, items and consequences.</Translate></p>
      </section>
    </main>
  </Layout>
}
