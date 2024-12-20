import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { PropsWithChildren } from "react";
import { useNpmDownloadCounter } from "./counters";
import { StableCounter } from "./StableCounter";

const App = () => {
  const stats = useQuery(api.stats.getStats, {
    githubOwner: "tanstack",
    npmOrg: "tanstack",
  });
  const liveNpmDownloadCount = useNpmDownloadCounter(stats?.npmOrg);
  return (
    <Card>
      <Stat label="Downloads">
        <StableCounter value={liveNpmDownloadCount} />
      </Stat>
      <Stat label="Stars" value={stats?.starCount} />
      <Stat label="Contributors" value={stats?.contributorCount} />
      <Stat label="Dependents" value={stats?.dependentCount} />
    </Card>
  );
};

const Card = ({ children }: PropsWithChildren) => (
  <div
    style={{
      width: "100vw",
      height: "100vh",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      background: "linear-gradient(to right, #f8f9fa, #e9ecef)",
    }}
  >
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: "40px",
        padding: "40px",
        background: "white",
        borderRadius: "12px",
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
      }}
    >
      {children}
    </div>
  </div>
);

const Stat = ({
  label,
  value,
  children,
}: PropsWithChildren<{ label: string; value?: number }>) => (
  <div style={{ padding: "20px" }}>
    <div
      style={{
        fontSize: "18px",
        fontFamily: "sans-serif",
        color: "#6c757d",
        marginBottom: "8px",
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: "36px",
        fontWeight: "bold",
        color: "#212529",
        fontFamily: "sans-serif",
      }}
    >
      {children ?? value?.toLocaleString()}
    </div>
  </div>
);

export default App;
