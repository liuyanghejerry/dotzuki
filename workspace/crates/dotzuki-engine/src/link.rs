//! Link-play transport seam — game-agnostic and zero-I/O.
//!
//! Any JRPG on this engine can do link play (battle, trade, … between two
//! players) by plugging a [`NetworkTransport`] implementation into its link
//! state machines. The engine defines the transport interface; each game
//! defines its own wire protocol — the message type `M` (e.g. a serde enum
//! serialized as JSON lines over TCP).
//!
//! This module is deliberately **zero-I/O**: it defines the trait, the shared
//! [`TransportError`], the [`LinkRole`] connection-side identity, and an
//! in-memory [`ChannelTransport`] pair for local/testing use. Real transports
//! (TCP sockets, Web `BroadcastChannel`, …) live in the game or platform
//! layer, never here.
//!
//! ## What lives here vs. in the game
//!
//! * **Engine (this module):** the [`NetworkTransport<M>`] trait,
//!   [`TransportError`], [`ChannelTransport<M>`], and [`LinkRole`] (which
//!   side clocks/hosts the connection — needed by any asymmetric handshake).
//! * **Game:** the wire message type `M`, the link state machines (battles,
//!   trades, …), and the concrete transports that implement this trait.
//!
//! ## Why `NetworkTransport<M>` (a type parameter, not an associated type)
//!
//! The message type is a plain generic parameter so implementations stay
//! one line (`impl<M> NetworkTransport<M> for ChannelTransport<M>`), trait
//! objects read as `dyn NetworkTransport<MyMessage>`, and the trait is usable
//! with several protocols if a transport ever needs that. An associated type
//! (`type Message`) would be equally valid — each transport would then own
//! exactly one message type — but the parameter was chosen for the least
//! ceremony across implementors.
//!
//! ## Usage
//!
//! ```text
//! // Game side: the wire protocol (a serde enum, a byte protocol, …).
//! enum MyMessage { Hello, Bye }
//!
//! // In-memory pair for local play / tests.
//! let (mut t_a, mut t_b) = ChannelTransport::<MyMessage>::new_pair();
//! t_a.send(MyMessage::Hello).unwrap();
//! assert_eq!(t_b.recv().unwrap(), MyMessage::Hello);
//! ```

use std::sync::mpsc;

/// Errors a [`NetworkTransport`] can report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    /// The peer is gone (socket closed, channel dropped, …).
    Disconnected,
    /// The operation timed out.
    Timeout,
    /// The message could not be (de)serialized on the wire.
    SerializationError(String),
    /// An underlying I/O failure (hosted by the implementing transport).
    IoError(String),
}

impl std::fmt::Display for TransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransportError::Disconnected => write!(f, "peer disconnected"),
            TransportError::Timeout => write!(f, "operation timed out"),
            TransportError::SerializationError(e) => write!(f, "serialization error: {}", e),
            TransportError::IoError(e) => write!(f, "I/O error: {}", e),
        }
    }
}

/// A bidirectional message transport for link play.
///
/// Implementors are the wire half of a link connection: they move whole
/// messages of the game's protocol type `M` in and out, hiding framing,
/// channels, threads, and sockets. The methods mirror `std::sync::mpsc`
/// semantics: [`Self::recv`] blocks until a message or a disconnect arrives,
/// [`Self::try_recv`] never blocks.
///
/// The engine defines this interface; each game implements it for its own
/// wire message type (see the [module docs](self)).
pub trait NetworkTransport<M> {
    /// Send one message to the peer.
    fn send(&mut self, msg: M) -> Result<(), TransportError>;

    /// Block until a message arrives or the connection fails.
    fn recv(&mut self) -> Result<M, TransportError>;

    /// Non-blocking receive: `Ok(None)` when nothing is pending,
    /// `Err(Disconnected)` once the peer is gone.
    fn try_recv(&mut self) -> Result<Option<M>, TransportError>;
}

/// An in-memory [`NetworkTransport`] pair over `std::sync::mpsc` channels.
///
/// The engine's built-in mock: the two ends of one link connection with
/// zero I/O, used for local play and tests. Dropping one end makes the
/// other report [`TransportError::Disconnected`] exactly like a closed
/// socket.
pub struct ChannelTransport<M> {
    tx: mpsc::Sender<M>,
    rx: mpsc::Receiver<M>,
}

impl<M> ChannelTransport<M> {
    /// Create a connected pair — the two ends of one link connection.
    pub fn new_pair() -> (Self, Self) {
        let (tx_a, rx_b) = mpsc::channel();
        let (tx_b, rx_a) = mpsc::channel();
        (
            ChannelTransport { tx: tx_a, rx: rx_a },
            ChannelTransport { tx: tx_b, rx: rx_b },
        )
    }
}

impl<M> NetworkTransport<M> for ChannelTransport<M> {
    fn send(&mut self, msg: M) -> Result<(), TransportError> {
        self.tx.send(msg).map_err(|_| TransportError::Disconnected)
    }

    fn recv(&mut self) -> Result<M, TransportError> {
        self.rx.recv().map_err(|_| TransportError::Disconnected)
    }

    fn try_recv(&mut self) -> Result<Option<M>, TransportError> {
        match self.rx.try_recv() {
            Ok(msg) => Ok(Some(msg)),
            Err(mpsc::TryRecvError::Empty) => Ok(None),
            Err(mpsc::TryRecvError::Disconnected) => Err(TransportError::Disconnected),
        }
    }
}

/// Which side of a link connection the local player is.
///
/// Link protocols with an asymmetric handshake need a host/guest
/// distinction — the original Game Boy link cable called it the "internal
/// clock" (the hosting side: drives synchronization, wins
/// simultaneous-request ties) versus the "external clock" (the joining
/// side: starts the handshake, defers to the host). Games map this onto
/// their own roles (the Pokémon Cable Club, for example, calls the two
/// sides the "player" and "friend" warp spots).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkRole {
    /// The clocking (hosting) side of the connection.
    Host,
    /// The joining (guest) side of the connection.
    Guest,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_send_recv() {
        let (mut a, mut b) = ChannelTransport::new_pair();
        a.send("hello".to_string()).unwrap();
        assert_eq!(b.recv().unwrap(), "hello");
        b.send("world".to_string()).unwrap();
        assert_eq!(a.recv().unwrap(), "world");
    }

    #[test]
    fn try_recv_empty_then_message() {
        let (mut a, mut b) = ChannelTransport::new_pair();
        assert_eq!(a.try_recv().unwrap(), None);
        b.send(7).unwrap();
        assert_eq!(a.try_recv().unwrap(), Some(7));
    }

    #[test]
    fn pair_ends_are_independent() {
        let (mut a, mut b) = ChannelTransport::new_pair();
        a.send(1).unwrap();
        // Our own send is not looped back to us.
        assert_eq!(a.try_recv().unwrap(), None);
        assert_eq!(b.try_recv().unwrap(), Some(1));
    }

    #[test]
    fn drop_reports_disconnected_to_peer() {
        let (a, mut b) = ChannelTransport::<u32>::new_pair();
        drop(a);
        assert_eq!(b.try_recv(), Err(TransportError::Disconnected));
        assert_eq!(b.recv(), Err(TransportError::Disconnected));
    }

    #[test]
    fn send_after_peer_drop_reports_disconnected() {
        let (mut a, b) = ChannelTransport::new_pair();
        drop(b);
        assert_eq!(a.send(1), Err(TransportError::Disconnected));
    }

    #[test]
    fn transport_error_display() {
        assert_eq!(TransportError::Disconnected.to_string(), "peer disconnected");
        assert_eq!(TransportError::Timeout.to_string(), "operation timed out");
        assert_eq!(
            TransportError::SerializationError("bad json".into()).to_string(),
            "serialization error: bad json"
        );
        assert_eq!(
            TransportError::IoError("reset".into()).to_string(),
            "I/O error: reset"
        );
    }
}
