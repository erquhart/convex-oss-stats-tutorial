import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

const App = () => {
  const owner = useQuery(api.stats.getGithubOwnerStats, { owner: "tanstack" });

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontSize: "100px",
          fontFamily: "sans-serif",
          margin: "auto",
        }}
      >
        {owner?.starCount}
      </div>
    </div>
  );
};

export default App;
