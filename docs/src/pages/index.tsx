import type {ReactNode} from 'react'
import Link from '@docusaurus/Link'
import Layout from '@theme/Layout'
import Heading from '@theme/Heading'
import styles from './index.module.css'

const paths = [
  {title: 'Play', text: 'Install the bundle, configure AI services and start a persistent story.', to: '/docs/getting-started/installation'},
  {title: 'Author worlds', text: 'Create characters, places, factions, lore and plots in the editor or with an approval-gated assistant.', to: '/docs/authoring/overview'},
  {title: 'Develop plugins', text: 'Use roleplay state, records and extension points from another DSH plugin.', to: '/docs/developers/architecture'},
]

export default function Home(): ReactNode {
  return <Layout title="Persistent agentic roleplay" description="Agent-driven roleplay, world authoring and persistent story state for DeepSeek Harness.">
    <header className={styles.hero}>
      <div className="container">
        <p className={styles.eyebrow}>DeepSeek Harness plugin bundle</p>
        <Heading as="h1">Stories whose characters can act for themselves</Heading>
        <p className={styles.lead}>Build editable worlds, play through a game-master agent, and preserve what every character knows, remembers and changes.</p>
        <div className={styles.actions}>
          <Link className="button button--primary button--lg" to="/docs/intro">Read the documentation</Link>
          <Link className="button button--secondary button--lg" href="https://github.com/Firefox2100/dsh-agentic-roleplay">View on GitHub</Link>
        </div>
      </div>
    </header>
    <main className={'container ' + styles.main}>
      <div className={styles.grid}>{paths.map(path => <Link className={styles.card} to={path.to} key={path.title}><Heading as="h2">{path.title}</Heading><p>{path.text}</p><span>Continue →</span></Link>)}</div>
      <section className={styles.summary}>
        <Heading as="h2">Agentic by design</Heading>
        <p>The world supplies identities, facts and possibilities—not a fixed dialogue tree. The GM coordinates autonomous character agents while session state records relationships, knowledge, memories, time, items and consequences.</p>
      </section>
    </main>
  </Layout>
}
