
const Stream = React.createClass({
  render: function() {
    return (
      <li>I am a Stream</li>
    );
  }
});

const StreamList = React.createClass({
  render: function() {
    return (
      <section className="streamList">
        <h1>Hello, world! I am a StreamList.</h1>
        <ul>
          <Stream />
        </ul>
      </section>
    );
  }
});

ReactDOM.render(
  <StreamList />,
  document.getElementById('app')
);