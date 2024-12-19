import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { PropsWithChildren } from "react";

const App = () => {
  const owner = useQuery(api.stats.getStats, {
    githubOwner: "tanstack",
    npmOrg: "tanstack",
  });
  return (
    <Card>
      <Stat label="Downloads" value={owner?.downloadCount} />
      <Stat label="Stars" value={owner?.starCount} />
      <Stat label="Contributors" value={owner?.contributorCount} />
      <Stat label="Dependents" value={owner?.dependentCount} />
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

const Stat = ({ label, value }: { label: string; value?: number }) => (
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
      {value?.toLocaleString()}
    </div>
  </div>
);

export default App;
