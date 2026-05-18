export function SkeletonSections() {
  return (
    <>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ marginBottom: 32, paddingLeft: 34 }}>
          <div className="skel-line" style={{ width: '40%', height: 22, marginLeft: -34 }} />
          <div className="skel-line" />
          <div className="skel-line" />
          <div className="skel-line" style={{ width: '80%' }} />
        </div>
      ))}
    </>
  );
}
